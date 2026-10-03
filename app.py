import os
import tempfile

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI
from paddleocr import PaddleOCR

load_dotenv()

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
DEFAULT_PROMPT = (
    "The following text was extracted from an image with OCR. "
    "Fix OCR errors, then return a clean, well-structured version of the text "
    "and a short summary of its content."
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


def extract_text(path: str) -> str:
    """Step 1: run PaddleOCR on an image or PDF (one result per page)."""
    pages = [res["rec_texts"] for res in ocr.predict(path)]
    if len(pages) == 1:
        return "\n".join(pages[0])
    return "\n\n".join(
        f"--- Page {i} ---\n" + "\n".join(lines) for i, lines in enumerate(pages, 1)
    )


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
