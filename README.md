# license-check

Checks if all licenses in package.json are osi conform.

## Links

* https://github.com/spdx/license-list-data/tree/main/json/details

## Jenkins configuration

1. Install NodeJS Plugin
2. Build Environment: Enable "Provide Node & npm bin/ folder to PATH"
3. Build Steps: Add "Execute shell" with the following command:
   ```
   npm i --package-lock-only
   git -C license-check pull || git clone https://github.com/SwissSocialArchives/license-check.git license-check
   cd license-check
   npm install
   cd ..
   node ./license-check/src/licenseCheck.js
   ```
4. Post-build Actions: Add "Record compiler warnings and static analysis results" with
   * Tool: Native Analysis Model Format
   * Report File Pattern: report.json
   * Custom Name: NPM audit

