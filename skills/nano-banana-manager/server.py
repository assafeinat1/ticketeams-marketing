"""
nano-banana-manager MCP Server
==============================
מנוע ליצירה ועריכה של תמונות באמצעות Google Imagen (nano-banana-pro-preview).
משתמש ב-GEMINI_API_KEY מקובץ .env.
"""

import os
import sys
import time
from typing import Optional
from pathlib import Path
import logging
from dotenv import load_dotenv
from fastmcp import FastMCP

# טעינת .env
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

# אתחול שרת MCP
mcp = FastMCP(
    "nano-banana-manager",
    instructions="שרת MCP ליצירת תמונות באמצעות Google Imagen API (nano-banana-pro-preview).",
)

# הגדרות
API_KEY = os.getenv("GEMINI_API_KEY")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./output")
MODEL_NAME = os.getenv("NANO_BANANA_MODEL", "nano-banana-pro-preview")

if not API_KEY:
    logger.warning("GEMINI_API_KEY לא מוגדר ב-.env — יצירת תמונות לא תעבוד")


def _get_client():
    """יוצר Google GenAI client."""
    from google import genai
    return genai.Client(api_key=API_KEY)


def _save_image(image_data: bytes, filename: str, output_dir: str) -> str:
    """שומר תמונה לדיסק ומחזיר את הנתיב."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    file_path = out_path / filename
    file_path.write_bytes(image_data)
    return str(file_path.resolve())


def _extract_image_from_response(response) -> tuple[bytes, str]:
    """מחלץ תמונה מתגובת Gemini. מחזיר (bytes, mime_type)."""
    for part in response.candidates[0].content.parts:
        if hasattr(part, "inline_data") and part.inline_data is not None:
            mime = part.inline_data.mime_type
            if mime and mime.startswith("image/"):
                return part.inline_data.data, mime
    raise ValueError("Gemini לא החזיר תמונה בתגובה")


@mcp.tool()
def generate_image(
    prompt: str,
    width: int = 1080,
    height: int = 1080,
    filename: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> str:
    """
    יצירת תמונה מטקסט באמצעות Google Imagen (nano-banana-pro-preview).

    Args:
        prompt: תיאור מפורט של התמונה הרצויה (באנגלית עובד הכי טוב)
        width: רוחב בפיקסלים (ברירת מחדל 1080)
        height: גובה בפיקסלים (ברירת מחדל 1080)
        filename: שם קובץ (ללא סיומת). אם לא צוין, ייווצר אוטומטית
        output_dir: תיקיית פלט. ברירת מחדל מ-.env

    Returns:
        נתיב מלא לתמונה שנוצרה, או הודעת שגיאה
    """
    try:
        if not API_KEY:
            raise ValueError("GEMINI_API_KEY לא מוגדר ב-.env")

        logger.info(f"Generating image: {prompt[:80]}...")

        client = _get_client()

        full_prompt = f"""{prompt}

IMAGE SPECIFICATIONS:
- Dimensions: exactly {width}x{height} pixels
- High quality, professional output
- No watermarks"""

        from google.genai import types

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        image_bytes, mime_type = _extract_image_from_response(response)

        ext = "png" if "png" in mime_type else "jpg"
        if not filename:
            filename = f"nano_banana_{int(time.time())}"
        final_filename = f"{filename}.{ext}"

        save_dir = output_dir or OUTPUT_DIR
        saved_path = _save_image(image_bytes, final_filename, save_dir)

        size_kb = len(image_bytes) / 1024
        logger.info(f"Image saved: {saved_path} ({size_kb:.0f} KB)")

        return f"התמונה נוצרה בהצלחה!\nנתיב: {saved_path}\nגודל: {size_kb:.0f} KB\nמודל: {MODEL_NAME}"

    except Exception as e:
        logger.error(f"שגיאה ביצירת תמונה: {e}", exc_info=True)
        return f"שגיאה ביצירת תמונה: {str(e)}"


@mcp.tool()
def generate_stadium_background(
    style: str = "epic",
    width: int = 1080,
    height: int = 1350,
    colors: str = "pink and orange",
    filename: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> str:
    """
    יצירת תמונת רקע של אצטדיון כדורגל — מותאם לפרסומות Ticketeams.

    Args:
        style: סגנון (epic/warm/dramatic/cinematic)
        width: רוחב בפיקסלים
        height: גובה בפיקסלים
        colors: צבעים דומיננטיים (pink and orange / blue / red)
        filename: שם קובץ
        output_dir: תיקיית פלט

    Returns:
        נתיב מלא לתמונה שנוצרה
    """
    style_map = {
        "epic": "grand and monumental with dramatic floodlight beams cutting through mist",
        "warm": "warm sunset lighting with golden hour glow across the pitch",
        "dramatic": "high contrast dramatic lighting with deep shadows and spotlight effects",
        "cinematic": "cinematic wide-angle shot with bokeh and lens flare effects",
    }
    style_desc = style_map.get(style, style_map["epic"])

    prompt = f"""Photorealistic football stadium background for a premium sports advertisement.

- A {style_desc}
- Lush green pitch visible at the bottom third
- Stadium stands packed with fans creating electric atmosphere
- {colors} color tones in the floodlights and ambient lighting
- Slight mist/fog for atmosphere and depth
- Night setting with dark sky
- NO text, NO logos, NO overlays — pure clean background
- Leave center area slightly darker for text overlay
- Ultra high quality, 8K detail level"""

    if not filename:
        filename = f"stadium_bg_{style}_{int(time.time())}"

    return generate_image(
        prompt=prompt,
        width=width,
        height=height,
        filename=filename,
        output_dir=output_dir,
    )


@mcp.tool()
def edit_image(
    image_path: str,
    prompt: str,
    filename: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> str:
    """
    עריכת תמונה קיימת — שולח את התמונה + prompt ל-Gemini לעיבוד.

    Args:
        image_path: נתיב לתמונה המקורית
        prompt: הנחיות לעריכה
        filename: שם קובץ לפלט
        output_dir: תיקיית פלט

    Returns:
        נתיב לתמונה הערוכה
    """
    try:
        if not API_KEY:
            raise ValueError("GEMINI_API_KEY לא מוגדר ב-.env")

        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"הקובץ לא נמצא: {image_path}")

        logger.info(f"Editing image: {image_path}")

        image_bytes = path.read_bytes()
        ext = path.suffix.lower()
        mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
        mime_type = mime_map.get(ext, "image/png")

        client = _get_client()
        from google.genai import types

        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )

        result_bytes, result_mime = _extract_image_from_response(response)

        result_ext = "png" if "png" in result_mime else "jpg"
        if not filename:
            filename = f"{path.stem}_edited_{int(time.time())}"
        final_filename = f"{filename}.{result_ext}"

        save_dir = output_dir or OUTPUT_DIR
        saved_path = _save_image(result_bytes, final_filename, save_dir)

        size_kb = len(result_bytes) / 1024
        logger.info(f"Edited image saved: {saved_path} ({size_kb:.0f} KB)")

        return f"התמונה נערכה בהצלחה!\nנתיב: {saved_path}\nגודל: {size_kb:.0f} KB"

    except Exception as e:
        logger.error(f"שגיאה בעריכת תמונה: {e}", exc_info=True)
        return f"שגיאה בעריכת תמונה: {str(e)}"


if __name__ == "__main__":
    logger.info(f"nano-banana-manager starting (model: {MODEL_NAME})...")
    mcp.run()
