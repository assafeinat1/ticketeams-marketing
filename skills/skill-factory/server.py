"""
Skill Factory — MCP Skill Generator
====================================

An MCP server that generates new FastMCP skill projects with complete file
structure, error handling, dotenv support, and .gitignore protection.

Tools:
    create_skill  — Create a new MCP skill project
    list_skills   — List all generated skills
    get_skill_info — Get details about a specific skill
"""

import json
import logging
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from jinja2 import Environment, FileSystemLoader

from fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

load_dotenv()

# Logging must go to stderr — stdout is reserved for MCP JSON-RPC
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("skill-factory")

# Paths
SCRIPT_DIR = Path(__file__).parent
SKILLS_DIR = SCRIPT_DIR.parent          # /skills/
TEMPLATES_DIR = SCRIPT_DIR / "templates"

# Jinja2 environment with custom helpers
jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
)


def _format_params(params: dict) -> str:
    """Turn {"name": "str", "count": "int"} into 'name: str, count: int'."""
    return ", ".join(f"{k}: {v}" for k, v in params.items())


jinja_env.filters["format_params"] = _format_params

# FastMCP server
mcp = FastMCP(
    "SkillFactory",
    instructions="MCP server that generates new FastMCP skill projects",
)

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ToolSpec:
    """Specification for a single tool inside a generated skill."""

    name: str
    description: str
    parameters: Optional[dict] = None   # {"param_name": "type_str"}
    return_type: str = "str"


@dataclass
class SkillSpec:
    """Full specification for a new skill project."""

    name: str
    description: str
    tools: list = field(default_factory=list)
    requires_api_key: bool = False
    api_key_var_name: str = ""


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@mcp.tool()
def create_skill(
    name: str,
    description: str,
    tools_json: str,
    requires_api_key: bool = False,
    api_key_var_name: Optional[str] = None,
) -> str:
    """Create a new MCP skill project with all required files.

    Args:
        name: Skill name in kebab-case (e.g. "nano-banana").
        description: Short description of what the skill does.
        tools_json: JSON array of tool objects. Each object:
                    {"name": "...", "description": "...",
                     "parameters": {"arg": "type"}, "return_type": "str"}
        requires_api_key: Set True if the skill needs an API key.
        api_key_var_name: Env-var name for the key (auto-generated if omitted).

    Returns:
        JSON string with creation status, path, and next steps.
    """
    try:
        # Normalise skill name
        skill_name = name.lower().replace(" ", "-").replace("_", "-")
        skill_dir = SKILLS_DIR / skill_name

        # Guard: don't overwrite existing skill
        if skill_dir.exists():
            return json.dumps(
                {"success": False, "error": f"Skill '{skill_name}' already exists at {skill_dir}"},
                ensure_ascii=False,
            )

        # Parse tool specs
        raw_tools = json.loads(tools_json)
        tools = [ToolSpec(**t) for t in raw_tools]

        # Build spec
        if not api_key_var_name:
            api_key_var_name = f"{skill_name.upper().replace('-', '_')}_API_KEY"

        spec = SkillSpec(
            name=skill_name,
            description=description,
            tools=tools,
            requires_api_key=requires_api_key,
            api_key_var_name=api_key_var_name,
        )

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        render_ctx = {"spec": spec, "timestamp": timestamp, "skill_path": str(skill_dir)}

        # Create directory
        skill_dir.mkdir(parents=True)

        # Render and write each template
        file_map = {
            "server.py": "server.py.j2",
            "requirements.txt": "requirements.txt.j2",
            ".env": "env.j2",
            ".gitignore": "gitignore.j2",
            "README.md": "readme.md.j2",
        }

        files_created = []
        for out_name, tmpl_name in file_map.items():
            template = jinja_env.get_template(tmpl_name)
            content = template.render(**render_ctx)
            (skill_dir / out_name).write_text(content, encoding="utf-8")
            files_created.append(out_name)

        logger.info("Created skill '%s' with %d files at %s", skill_name, len(files_created), skill_dir)

        return json.dumps(
            {
                "success": True,
                "skill_name": skill_name,
                "path": str(skill_dir),
                "files_created": files_created,
                "tools_count": len(tools),
                "next_steps": [
                    f"cd '{skill_dir}' && pip install -r requirements.txt",
                    *(["Edit .env and set your API key"] if requires_api_key else []),
                    "python server.py",
                    f'Add to .mcp.json:  "{skill_name}": {{"command": "python", "args": ["{skill_dir / "server.py"}"]}}',
                ],
            },
            ensure_ascii=False,
            indent=2,
        )

    except json.JSONDecodeError as exc:
        logger.error("Invalid tools_json: %s", exc)
        return json.dumps({"success": False, "error": f"Invalid JSON in tools_json: {exc}"})
    except Exception as exc:
        logger.error("Failed to create skill '%s': %s", name, exc, exc_info=True)
        return json.dumps({"success": False, "error": str(exc)})


@mcp.tool()
def list_skills() -> str:
    """List all MCP skills generated by the factory.

    Returns:
        JSON string with skill count and metadata for each skill.
    """
    try:
        skills = []
        for item in sorted(SKILLS_DIR.iterdir()):
            if not item.is_dir() or item.name == "skill-factory":
                continue
            server_file = item / "server.py"
            if not server_file.exists():
                continue

            info: dict = {"name": item.name, "path": str(item)}

            readme = item / "README.md"
            if readme.exists():
                lines = [l.strip() for l in readme.read_text(encoding="utf-8").splitlines() if l.strip()]
                if len(lines) > 1:
                    info["description"] = lines[1][:200]

            skills.append(info)

        logger.info("Found %d skills", len(skills))
        return json.dumps({"success": True, "count": len(skills), "skills": skills}, ensure_ascii=False, indent=2)

    except Exception as exc:
        logger.error("Failed to list skills: %s", exc, exc_info=True)
        return json.dumps({"success": False, "error": str(exc)})


@mcp.tool()
def get_skill_info(skill_name: str) -> str:
    """Get detailed information about a generated skill.

    Args:
        skill_name: Name of the skill (e.g. "nano-banana").

    Returns:
        JSON string with file list, sizes, and completeness check.
    """
    try:
        skill_dir = SKILLS_DIR / skill_name
        if not skill_dir.exists():
            return json.dumps({"success": False, "error": f"Skill '{skill_name}' not found"})

        files = {}
        for f in skill_dir.iterdir():
            if f.is_file():
                files[f.name] = {"size_bytes": f.stat().st_size}

        required = ["server.py", "requirements.txt", ".env", ".gitignore", "README.md"]
        missing = [f for f in required if f not in files]

        return json.dumps(
            {
                "success": True,
                "skill_name": skill_name,
                "path": str(skill_dir),
                "files": files,
                "missing_files": missing,
                "is_complete": len(missing) == 0,
            },
            ensure_ascii=False,
            indent=2,
        )

    except Exception as exc:
        logger.error("Failed to get info for '%s': %s", skill_name, exc, exc_info=True)
        return json.dumps({"success": False, "error": str(exc)})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("Starting Skill Factory MCP Server...")
    mcp.run()
