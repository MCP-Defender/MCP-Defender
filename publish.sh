# Builds for Mac on Apple Silicon and Intel and publishes to S3
npm run publish -- --arch=universal --platform=darwin --enable-logging

echo "Published Mac app to S3"