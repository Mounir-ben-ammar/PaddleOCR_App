import json
import os
import tempfile

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI
from paddleocr import PaddleOCR

load_dotenv()

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
PROMPT = (
    "The following text was extracted from a document with OCR and may contain errors. "
    "Find the name of the sender (the person or company who issued or sent the document) "
    "and the total amount, including its currency. "
    'Answer only with JSON: {"sender": "...", "amount": "..."}. '
    "Use null for a value you cannot find."
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


def ask_llm(ocr_text: str) -> tuple[str | None, str | None]:
    """Step 2: send the OCR output to GPT and get back the sender and amount."""
    response = client.chat.completions.create(
        model=MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": ocr_text},
        ],
    )
    data = json.loads(response.choices[0].message.content)
    return data.get("sender"), data.get("amount")


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/process")
def process():
    file = request.files.get("image")
    if not file or not file.filename:
        return jsonify(error="No file uploaded"), 400

    suffix = os.path.splitext(file.filename)[1] or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        file.save(tmp.name)
        path = tmp.name
    try:
        ocr_text = extract_text(path)
    finally:
        os.remove(path)

    if not ocr_text.strip():
        return jsonify(error="No text detected in the image")

    try:
        sender, amount = ask_llm(ocr_text)
    except Exception as e:
        return jsonify(error=f"LLM error: {e}"), 502

    return jsonify(sender=sender, amount=amount)


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
