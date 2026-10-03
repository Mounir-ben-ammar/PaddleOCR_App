import os
import tempfile
import threading

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI
from paddleocr import PaddleOCR

load_dotenv()

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
DEFAULT_PROMPT = (
    "The following text was extracted from an image with OCR. The spacing "
    "reflects the original page layout: text on the same line was on the same "
    "row, and wide gaps separate columns. Fix OCR errors, then return a clean, "
    "well-structured version of the text and a short summary of its content. "
    "Pair each label with the value on its own row or column; if a value "
    "cannot be matched to a label with certainty, leave the field empty "
    "rather than guessing. Never invent data."
)

app = Flask(__name__)
client = OpenAI()  # reads OPENAI_API_KEY from the environment
ocr = PaddleOCR(
    lang=os.getenv("OCR_LANG", "en"),
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,  # oneDNN crashes on Windows with paddlepaddle 3.3
)
# PaddleOCR is not thread-safe: run one OCR job at a time
ocr_lock = threading.Lock()


def layout_text(boxes, texts) -> str:
    """Rebuild a page's layout from PaddleOCR boxes (x1, y1, x2, y2).

    Boxes whose vertical centers are close go on the same row, sorted left to
    right, and horizontal gaps become spaces, so labels stay next to their
    values and table columns stay aligned.
    """
    items = [(*map(float, b), t) for b, t in zip(boxes, texts) if t.strip()]
    if not items:
        return ""
    heights = sorted(y2 - y1 for _, y1, _, y2, _ in items)
    row_tol = heights[len(heights) // 2] * 0.5
    char_ws = sorted((x2 - x1) / len(t) for x1, _, x2, _, t in items)
    char_w = max(char_ws[len(char_ws) // 2], 1)

    rows = []
    for it in sorted(items, key=lambda b: (b[1] + b[3]) / 2):
        yc = (it[1] + it[3]) / 2
        if rows and abs(yc - rows[-1]["yc"]) <= row_tol:
            rows[-1]["items"].append(it)
        else:
            rows.append({"yc": yc, "items": [it]})

    min_x = min(it[0] for it in items)
    lines = []
    for row in rows:
        line = ""
        for x1, _, _, _, text in sorted(row["items"], key=lambda b: b[0]):
            col = int((x1 - min_x) / char_w)
            line += " " * max(col - len(line), 1 if line else 0) + text
        lines.append(line)
    return "\n".join(lines)


def extract_text(path: str) -> str:
    """Step 1: run PaddleOCR on an image or PDF (one result per page)."""
    with ocr_lock:
        pages = [layout_text(res["rec_boxes"], res["rec_texts"]) for res in ocr.predict(path)]
    if len(pages) == 1:
        return pages[0]
    return "\n\n".join(f"--- Page {i} ---\n{text}" for i, text in enumerate(pages, 1))


def ask_llm(ocr_text: str, instruction: str) -> str:
    """Step 2: send the OCR output to GPT."""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": instruction},
            {"role": "user", "content": ocr_text},
        ],
    )
    return response.choices[0].message.content


@app.get("/")
def index():
    return render_template("index.html", default_prompt=DEFAULT_PROMPT)


@app.post("/process")
def process():
    file = request.files.get("image")
    if not file or not file.filename:
        return jsonify(error="No file uploaded"), 400
    instruction = request.form.get("prompt") or DEFAULT_PROMPT

    suffix = os.path.splitext(file.filename)[1] or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        file.save(tmp.name)
        path = tmp.name
    try:
        ocr_text = extract_text(path)
    except Exception as e:
        return jsonify(ocr_text="", llm_output="", error=f"OCR error: {e}"), 500
    finally:
        os.remove(path)

    if not ocr_text.strip():
        return jsonify(ocr_text="", llm_output="", error="No text detected in the image")

    try:
        llm_output = ask_llm(ocr_text, instruction)
    except Exception as e:
        return jsonify(ocr_text=ocr_text, llm_output="", error=f"LLM error: {e}"), 502

    return jsonify(ocr_text=ocr_text, llm_output=llm_output)


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
