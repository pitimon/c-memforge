#!/bin/bash
#
# Build MemForge Client package for Claude Cowork
#
# Usage:
#   ./scripts/build-cowork.sh [api-key]
#
# If no API key provided, uses default Cowork key

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PLUGIN_ROOT}"
OUTPUT_FILE="memforge-client-cowork.zip"

# Default Cowork API key (embedded in package)
DEFAULT_API_KEY="***REMOVED***"

# Use provided key or default
API_KEY="${1:-$DEFAULT_API_KEY}"

echo "╔══════════════════════════════════════════════╗"
echo "║  MemForge Cowork Package Builder             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Create temp directory
COWORK_DIR=$(mktemp -d)
echo "Building in: $COWORK_DIR"

# Copy plugin files
echo "Copying plugin files..."
cp -r "$PLUGIN_ROOT/.claude-plugin" "$COWORK_DIR/"
mkdir -p "$COWORK_DIR/src"
cp -r "$PLUGIN_ROOT/src/mcp" "$COWORK_DIR/src/"
cp "$PLUGIN_ROOT/.mcp.json" "$COWORK_DIR/"
cp "$PLUGIN_ROOT/tsconfig.json" "$COWORK_DIR/"

# Remove marketplace.json (not needed for direct upload)
rm -f "$COWORK_DIR/.claude-plugin/marketplace.json"

# Create simplified package.json
cat > "$COWORK_DIR/package.json" << 'EOF'
{
  "name": "memforge-client",
  "version": "1.0.0",
  "description": "MemForge - Persistent semantic memory for Claude Cowork",
  "type": "module",
  "scripts": {
    "mcp": "bun src/mcp/mcp-server.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.1"
  }
}
EOF

# Create plugin.json for Cowork
cat > "$COWORK_DIR/.claude-plugin/plugin.json" << 'EOF'
{
  "name": "memforge-client",
  "version": "1.0.0",
  "description": "MemForge - Persistent semantic memory for Claude (Pre-configured)",
  "author": {
    "name": "Pitimon",
    "email": "pitimon@thaicloud.ai"
  },
  "homepage": "https://github.com/pitimon/c-memforge"
}
EOF

# Create embedded config with API key
echo "Embedding API key: ${API_KEY:0:4}****${API_KEY: -4}"
cat > "$COWORK_DIR/config.local.json" << EOF
{
  "apiKey": "$API_KEY",
  "serverUrl": "https://memclaude.thaicloud.ai",
  "syncEnabled": false,
  "pollInterval": 2000
}
EOF

# Create ZIP
echo "Creating ZIP package..."
cd "$COWORK_DIR"
zip -rq "$OUTPUT_DIR/$OUTPUT_FILE" .

# Cleanup
rm -rf "$COWORK_DIR"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Build Complete!                             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Output: $OUTPUT_DIR/$OUTPUT_FILE"
echo "Size: $(ls -lh "$OUTPUT_DIR/$OUTPUT_FILE" | awk '{print $5}')"
echo ""
echo "To use:"
echo "  1. Open Claude Cowork"
echo "  2. Go to Plugins → Upload local plugin"
echo "  3. Drag & drop $OUTPUT_FILE"
echo ""
