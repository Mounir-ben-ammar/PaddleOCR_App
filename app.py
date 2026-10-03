import json
import os
import tempfile

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI
from paddleocr import PaddleOCR

load_dotenv()

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
INSTRUCTION = (
    "The user message is text extracted by OCR from a receipt, so it may contain OCR errors. "
    "Extract these fields and answer with a JSON object only:\n"
    '- "sender": the name of the business or person who issued the receipt\n'
    '- "amount": the total amount paid, including the currency (e.g. "1,250.00 TND")\n'
    '- "date": the receipt date in YYYY-MM-DD format\n'
    "Use null for any field you cannot find."
)
FIELDS = ("sender", "amount", "date")

app = Flask(__name__)
client = OpenAI()  # reads OPENAI_API_KEY from the environment
ocr = PaddleOCR(
    lang=os.getenv("OCR_LANG", "en"),
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,  # oneDNN crashes on Windows with paddlepaddle 3.3
)


def extract_text(path: str) -> list[str]:
    """Step 1: run PaddleOCR on an image or PDF and return the text of each page."""
    return ["\n".join(res["rec_texts"]) for res in ocr.predict(path)]


def extract_fields(ocr_text: str) -> dict:
    """Step 2: ask GPT for the sender, amount and date of one receipt."""
    response = client.chat.completions.create(
        model=MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": INSTRUCTION},
            {"role": "user", "content": ocr_text},
        ],
    )
    data = json.loads(response.choices[0].message.content)
    return {field: data.get(field) for field in FIELDS}


def process_receipt(page: int, ocr_text: str) -> dict:
    result = {"page": page, "sender": None, "amount": None, "date": None}
    if not ocr_text.strip():
        return {**result, "error": "No text detected"}
    try:
        result.update(extract_fields(ocr_text))
    except Exception as e:
        return {**result, "error": f"LLM error: {e}"}
    return result


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
        pages = extract_text(path)
    except Exception as e:
        return jsonify(error=f"OCR error: {e}"), 500
    finally:
        os.remove(path)

    if not any(text.strip() for text in pages):
        return jsonify(error="No text detected in the file")

    # Each PDF page is treated as a separate receipt.
    return jsonify(receipts=[process_receipt(i, text) for i, text in enumerate(pages, 1)])


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
