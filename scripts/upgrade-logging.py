#!/usr/bin/env python3
"""
Script to automatically replace console.* calls with logger calls
Handles patterns like:
- console.log('[Tag] message') -> logger.log('Tag', 'message')
- console.log('[Tag]', 'message') -> logger.log('Tag', 'message')
- console.error('[Tag] message') -> logger.error('Tag', 'message')
- console.warn('[Tag] message') -> logger.warn('Tag', 'message')
"""

import re
import os
import sys
from pathlib import Path

# Files to process
TARGET_FILES = [
    'src/hooks/useWakeWordDetector.ts',
    'src/components/Player.tsx',
    'api-server.ts',
    'api/ai-audio.ts',
    # Add more files as needed
]

# Patterns to match console calls with tags
PATTERNS = [
    # console.log('[Tag] message')
    (r"console\.(log|warn|error|info)\s*\(\s*'\[([^\]]+)\]\s*([^']+)'", r"logger.\1('\2', '\3'"),
    # console.log('[Tag]', 'message')
    (r"console\.(log|warn|error|info)\s*\(\s*'\[([^\]]+)\]'\s*,\s*", r"logger.\1('\2', "),
    # console.log('[Tag] message', ...args)
    (r"console\.(log|warn|error|info)\s*\(\s*`\[([^\]]+)\]\s*([^`]+)`", r"logger.\1('\2', `\3`"),
    # console.log('[Tag]', ...args) - already handled above
    # console.log('message') - no tag, just message
    (r"console\.(log|warn|error|info)\s*\(\s*'([^']+)'", r"logger.\1('\2'"),
    # console.log(`message`) - template literal, no tag
    (r"console\.(log|warn|error|info)\s*\(\s*`([^`]+)`", r"logger.\1(`\2`"),
    # console.log(message) - variable or expression
    (r"console\.(log|warn|error|info)\s*\(\s*([^,)]+)\)", r"logger.\1(\2)"),
]

def extract_tag_and_message(line):
    """Extract tag and message from console call"""
    # Pattern 1: console.log('[Tag] message')
    match = re.search(r"console\.(log|warn|error|info)\s*\(\s*'\[([^\]]+)\]\s*([^']+)'", line)
    if match:
        method = match.group(1)
        tag = match.group(2)
        message = match.group(3)
        return method, tag, message, match.start(), match.end()
    
    # Pattern 2: console.log('[Tag]', 'message', ...)
    match = re.search(r"console\.(log|warn|error|info)\s*\(\s*'\[([^\]]+)\]'\s*,\s*(.+)", line)
    if match:
        method = match.group(1)
        tag = match.group(2)
        rest = match.group(3)
        # Find the end of the first argument (could be string, template literal, or expression)
        return method, tag, rest, match.start(), None
    
    # Pattern 3: console.log('message') - no tag
    match = re.search(r"console\.(log|warn|error|info)\s*\(\s*'([^']+)'", line)
    if match:
        method = match.group(1)
        message = match.group(2)
        # Check if message looks like it has a tag pattern
        if message.startswith('[') and ']' in message:
            # Extract tag from message
            tag_match = re.match(r'\[([^\]]+)\]\s*(.+)', message)
            if tag_match:
                tag = tag_match.group(1)
                message = tag_match.group(2)
                return method, tag, message, match.start(), match.end()
        # No tag, just message
        return method, None, message, match.start(), match.end()
    
    # Pattern 4: console.log(`[Tag] message`)
    match = re.search(r"console\.(log|warn|error|info)\s*\(\s*`\[([^\]]+)\]\s*([^`]+)`", line)
    if match:
        method = match.group(1)
        tag = match.group(2)
        message = match.group(3)
        return method, tag, f"`{message}`", match.start(), match.end()
    
    return None

def replace_console_call(line):
    """Replace a single console call with logger call"""
    result = extract_tag_and_message(line)
    if not result:
        return line
    
    method, tag, message, start, end = result
    
    # Build replacement
    if tag:
        # Has tag: logger.method('Tag', 'message')
        if message.strip().startswith('`'):
            # Template literal
            replacement = f"logger.{method}('{tag}', {message}"
        else:
            # Regular string - need to handle quotes
            if "'" in message:
                # Escape single quotes or use template literal
                replacement = f"logger.{method}('{tag}', `{message}`"
            else:
                replacement = f"logger.{method}('{tag}', '{message}'"
    else:
        # No tag: logger.method('message')
        if message.strip().startswith('`'):
            replacement = f"logger.{method}({message}"
        else:
            replacement = f"logger.{method}('{message}'"
    
    # Replace the console call
    if end:
        new_line = line[:start] + replacement + line[end:]
    else:
        # For multi-line cases, just replace the start
        new_line = line[:start] + replacement + line[match.end():]
    
    return new_line

def process_file(file_path):
    """Process a single file"""
    file_path = Path(file_path)
    if not file_path.exists():
        print(f"[WARN] File not found: {file_path}")
        return False
    
    print(f"Processing: {file_path}")
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            lines = content.split('\n')
    except Exception as e:
        print(f"Error reading file: {e}")
        return False
    
    modified = False
    new_lines = []
    
    for i, line in enumerate(lines):
        original_line = line
        
        # Skip if already using logger
        if 'logger.' in line and 'console.' not in line:
            new_lines.append(line)
            continue
        
        # Find all console.* calls in this line
        if 'console.log' in line or 'console.warn' in line or 'console.error' in line or 'console.info' in line:
            # Try multiple replacement strategies
            new_line = line
            
            # Strategy 1: console.log('[Tag] message')
            new_line = re.sub(
                r"console\.(log|warn|error|info)\s*\(\s*'\[([^\]]+)\]\s*([^']+)'",
                r"logger.\1('\2', '\3'",
                new_line
            )
            
            # Strategy 2: console.log('[Tag]', 'message', ...)
            new_line = re.sub(
                r"console\.(log|warn|error|info)\s*\(\s*'\[([^\]]+)\]'\s*,\s*",
                r"logger.\1('\2', ",
                new_line
            )
            
            # Strategy 3: console.log('message') where message starts with [Tag]
            def replace_with_tag(match):
                method = match.group(1)
                full_msg = match.group(2)
                # Check if it has [Tag] pattern
                tag_match = re.match(r'\[([^\]]+)\]\s*(.+)', full_msg)
                if tag_match:
                    tag = tag_match.group(1)
                    msg = tag_match.group(2)
                    return f"logger.{method}('{tag}', '{msg}'"
                else:
                    return f"logger.{method}('{full_msg}'"
            
            new_line = re.sub(
                r"console\.(log|warn|error|info)\s*\(\s*'([^']+)'",
                replace_with_tag,
                new_line
            )
            
            # Strategy 4: console.log(`[Tag] message`)
            new_line = re.sub(
                r"console\.(log|warn|error|info)\s*\(\s*`\[([^\]]+)\]\s*([^`]+)`",
                r"logger.\1('\2', `\3`",
                new_line
            )
            
            # Strategy 5: console.log(`message`) - no tag
            new_line = re.sub(
                r"console\.(log|warn|error|info)\s*\(\s*`([^`]+)`",
                r"logger.\1(`\2`",
                new_line
            )
            
            if new_line != original_line:
                modified = True
                new_lines.append(new_line)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)
    
    if modified:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(new_lines))
            print(f"[OK] Updated: {file_path}")
            return True
        except Exception as e:
            print(f"[ERROR] Error writing file: {e}")
            return False
    else:
        print(f"[SKIP] No changes: {file_path}")
        return False

def main():
    """Main function"""
    print("Starting logging upgrade script...\n")
    
    # Find all TypeScript/TSX files if no specific files provided
    if len(sys.argv) > 1:
        files = sys.argv[1:]
    else:
        # Auto-discover files
        files = []
        for root, dirs, filenames in os.walk('.'):
            # Skip node_modules and other dirs
            if 'node_modules' in root or '.git' in root or 'dist' in root:
                continue
            
            for filename in filenames:
                if filename.endswith(('.ts', '.tsx')) and not filename.endswith('.d.ts'):
                    filepath = os.path.join(root, filename)
                    # Skip if already processed or in certain dirs
                    if 'test' not in filepath.lower() and 'spec' not in filepath.lower():
                        files.append(filepath)
    
    if not files:
        files = TARGET_FILES
    
    print(f"Found {len(files)} file(s) to process\n")
    
    updated_count = 0
    for file_path in files:
        if process_file(file_path):
            updated_count += 1
        print()
    
    print(f"Done! Updated {updated_count} file(s)")

if __name__ == '__main__':
    main()

