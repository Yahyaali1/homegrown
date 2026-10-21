# Document reader: pdf.js (PDF text) and mammoth (DOCX to HTML).
set -e
rm -rf extension/vendor/reading
mkdir -p extension/vendor/reading
cp node_modules/pdfjs-dist/build/pdf.min.mjs node_modules/pdfjs-dist/build/pdf.worker.min.mjs extension/vendor/reading/
cp node_modules/mammoth/mammoth.browser.min.js extension/vendor/reading/
