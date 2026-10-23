# Document reader: pdf.js (PDF text) and mammoth (DOCX to HTML).
set -e
rm -rf legacy/vendor/reading
mkdir -p legacy/vendor/reading
cp node_modules/pdfjs-dist/build/pdf.min.mjs node_modules/pdfjs-dist/build/pdf.worker.min.mjs legacy/vendor/reading/
cp node_modules/mammoth/mammoth.browser.min.js legacy/vendor/reading/
