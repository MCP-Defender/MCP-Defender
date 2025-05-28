# Builds for Mac on Apple Silicon and Intel and publishes to Github
npm run publish --arch=arm64 --platform=darwin --enable-logging
npm run publish --arch=x64 --platform=darwin --enable-logging

echo "Published MCP Defender to Github Releases: https://github.com/MCP-Defender/MCP-Defender/releases"
