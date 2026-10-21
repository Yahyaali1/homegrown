# Mozilla Readability (main-content extraction), injected into pages with lib/pageread.js.
set -e
mkdir -p extension/vendor
cp node_modules/@mozilla/readability/Readability.js extension/vendor/readability.js
