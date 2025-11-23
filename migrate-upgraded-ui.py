#!/usr/bin/env python3
"""
Migrate upgraded AI UI files to main project with backup
"""
import os
import shutil
import sys
from pathlib import Path
from datetime import datetime

# Fix Windows console encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Paths
UPGRADED_DIR = Path("upgraded ai ui")
PROJECT_DIR = Path(".")
BACKUP_DIR = Path("backup_before_upgrade")

# Files/dirs to exclude from migration
EXCLUDE = {
    "node_modules",
    "dist",
    ".git",
    "backup_before_upgrade",
    "upgraded ai ui",
    "wakeword-venv",
    ".vscode",
    ".idea",
    "__pycache__",
    "*.pyc",
    ".DS_Store",
}

# Files to skip (keep existing)
SKIP_FILES = {
    "package.json",  # Keep existing package.json
    "package-lock.json",
    "tsconfig.json",
    "README.md",
}

def should_exclude(path: Path) -> bool:
    """Check if path should be excluded"""
    path_str = str(path).replace("\\", "/")
    name = path.name
    
    # Check exact name matches
    if name in EXCLUDE:
        return True
    
    # Check if path contains excluded directories (but not as part of "upgraded ai ui")
    for exclude in EXCLUDE:
        if exclude.startswith("*"):
            # Pattern matching
            if name.endswith(exclude[1:]):
                return True
        elif "/" + exclude + "/" in path_str or path_str.startswith(exclude + "/") or path_str.endswith("/" + exclude):
            # Only exclude if it's a real directory match, not part of "upgraded ai ui"
            if "upgraded ai ui" not in path_str or exclude not in ["upgraded ai ui"]:
                return True
    
    # Exclude hidden files/dirs
    if name.startswith(".") and name != ".gitignore":
        return True
    
    return False

def get_all_files(directory: Path, relative_to: Path = None) -> dict:
    """Get all files in directory with their relative paths"""
    files = {}
    if not directory.exists():
        return files
    
    if relative_to is None:
        relative_to = directory
    
    for root, dirs, filenames in os.walk(directory):
        # Filter out excluded directories
        dirs[:] = [d for d in dirs if not should_exclude(Path(root) / d)]
        
        for filename in filenames:
            if should_exclude(Path(root) / filename):
                continue
            
            file_path = Path(root) / filename
            rel_path = file_path.relative_to(relative_to)
            files[str(rel_path)] = file_path
    
    return files

def backup_file(file_path: Path, backup_base: Path):
    """Backup a file to backup directory"""
    if not file_path.exists():
        return
    
    backup_path = backup_base / file_path
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file_path, backup_path)
    print(f"  [BACKUP] Backed up: {file_path}")

def copy_file(src: Path, dst: Path, backup_base: Path = None):
    """Copy file and optionally backup destination"""
    if backup_base and dst.exists():
        backup_file(dst, backup_base)
    
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"  [OK] Copied: {src} -> {dst}")

def main():
    print("=" * 60)
    print("AI UI Upgrade Migration Script")
    print("=" * 60)
    print()
    
    if not UPGRADED_DIR.exists():
        print(f"[ERROR] '{UPGRADED_DIR}' directory not found!")
        print(f"Current directory: {Path.cwd()}")
        print(f"Looking for: {UPGRADED_DIR.absolute()}")
        return
    
    # Get all files from both directories
    print("Scanning files...")
    upgraded_files = get_all_files(UPGRADED_DIR, UPGRADED_DIR)
    project_files = get_all_files(PROJECT_DIR, PROJECT_DIR)
    
    print(f"Found {len(upgraded_files)} files in upgraded directory")
    print(f"Found {len(project_files)} files in project directory")
    print()
    
    # Create backup directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = BACKUP_DIR / timestamp
    backup_dir.mkdir(parents=True, exist_ok=True)
    print(f"[BACKUP] Backup directory: {backup_dir}")
    print()
    
    # Find differences
    new_files = []
    changed_files = []
    same_files = []
    
    for rel_path, upgraded_path in upgraded_files.items():
        if rel_path in SKIP_FILES:
            print(f"[SKIP] Skipping: {rel_path} (in skip list)")
            continue
        
        project_path = PROJECT_DIR / rel_path
        
        if not project_path.exists():
            new_files.append((rel_path, upgraded_path, project_path))
        else:
            # Check if files are different
            try:
                if upgraded_path.read_bytes() != project_path.read_bytes():
                    changed_files.append((rel_path, upgraded_path, project_path))
                else:
                    same_files.append(rel_path)
            except Exception as e:
                print(f"[WARN] Error comparing {rel_path}: {e}")
                changed_files.append((rel_path, upgraded_path, project_path))
    
    # Report
    print("=" * 60)
    print("MIGRATION SUMMARY")
    print("=" * 60)
    print(f"New files: {len(new_files)}")
    print(f"Changed files: {len(changed_files)}")
    print(f"Unchanged files: {len(same_files)}")
    print()
    
    if new_files:
        print("[NEW] NEW FILES:")
        for rel_path, _, _ in new_files:
            print(f"  + {rel_path}")
        print()
    
    if changed_files:
        print("[CHANGED] CHANGED FILES:")
        for rel_path, _, _ in changed_files:
            print(f"  ~ {rel_path}")
        print()
    
    # Ask for confirmation
    total_changes = len(new_files) + len(changed_files)
    if total_changes == 0:
        print("[INFO] No changes to migrate!")
        return
    
    print(f"Ready to migrate {total_changes} files")
    
    # Auto-proceed if running non-interactively or if --yes flag is provided
    import sys
    auto_yes = '--yes' in sys.argv or not sys.stdin.isatty()
    
    if not auto_yes:
        response = input("Proceed? (y/n): ").strip().lower()
        if response != 'y':
            print("[CANCELLED] Migration cancelled")
            return
    else:
        print("[AUTO] Auto-proceeding with migration...")
    
    print()
    print("=" * 60)
    print("MIGRATING FILES")
    print("=" * 60)
    print()
    
    # Migrate new files
    if new_files:
        print("[COPY] Copying new files...")
        for rel_path, upgraded_path, project_path in new_files:
            copy_file(upgraded_path, project_path, backup_dir)
        print()
    
    # Migrate changed files
    if changed_files:
        print("[UPDATE] Updating changed files...")
        for rel_path, upgraded_path, project_path in changed_files:
            copy_file(upgraded_path, project_path, backup_dir)
        print()
    
    # Handle removed files (files in project but not in upgraded)
    removed_files = []
    for rel_path, project_path in project_files.items():
        if rel_path in SKIP_FILES:
            continue
        if rel_path not in upgraded_files and rel_path not in str(BACKUP_DIR):
            # Check if it's a source file (not build artifact)
            if rel_path.startswith(("src/", "api/", "scripts/")) or rel_path.endswith((".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".config.js", ".config.ts")):
                removed_files.append((rel_path, project_path))
    
    if removed_files:
        print("[REMOVED] FILES IN PROJECT BUT NOT IN UPGRADED VERSION:")
        for rel_path, _ in removed_files:
            print(f"  - {rel_path} (not removed, check manually)")
        print()
    
    print("=" * 60)
    print("[SUCCESS] MIGRATION COMPLETE!")
    print("=" * 60)
    print(f"Backup saved to: {backup_dir}")
    print()
    print("Next steps:")
    print("1. Review the changes")
    print("2. Test the application")
    print("3. Check for any import errors or missing dependencies")

if __name__ == "__main__":
    main()

