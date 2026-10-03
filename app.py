import json
import os
import tempfile

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI
from paddleocr import PaddleOCR

load_dotenv()

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
EXTRACT_PROMPT = (
    "The following text was extracted from a document with OCR and may contain errors. "
    "Extract exactly three fields and answer with a JSON object only, using these keys: "
    '"sender_name" (the person or company that sent/ordered the payment), '
    '"amount" (the transaction amount, with its currency if shown), '
    '"date" (the operation date, formatted DD/MM/YYYY). '
    "Use null for any field that is not present. Do not invent values."
)
FIELDS = ("sender_name", "amount", "date")

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


def ask_llm(ocr_text: str) -> dict:
    """Step 2: send the OCR output to GPT and get the three fields back as JSON."""
    response = client.chat.completions.create(
        model=MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": EXTRACT_PROMPT},
            {"role": "user", "content": ocr_text},
        ],
    )
    data = json.loads(response.choices[0].message.content)
    return {key: data.get(key) for key in FIELDS}


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
        return jsonify(error="No text detected in the file")

    try:
        fields = ask_llm(ocr_text)
    except Exception as e:
        return jsonify(error=f"LLM error: {e}"), 502

    return jsonify(fields=fields)


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
