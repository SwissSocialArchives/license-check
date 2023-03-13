const fs = require('fs')
const path = require('path')
const isOSIApproved = require('spdx-is-osi')
const correct = require('spdx-correct')

const packageJsonRaw = fs.readFileSync('./package.json').toString()
const packageJson = JSON.parse(packageJsonRaw)
const packageLock = JSON.parse(fs.readFileSync('./package-lock.json').toString())

let issues = []

/**
 * Extract license type from content of a package.json file
 * https://github.com/ironSource/license-report/blob/master/lib/extractLicense.js
 * @param {object} packageJSONContent - content of package.json for 1 package
 * @returns {string} with license type
 */
function extractLicense(packageJSONContent) {
    if (typeof packageJSONContent.license === 'string') {
        return packageJSONContent.license
    }

    if (typeof packageJSONContent.license === 'object') {
        return packageJSONContent.license.type
    }

    if (Array.isArray(packageJSONContent.licenses)) {
        const licenseTypes = []
        for (const license of packageJSONContent.licenses) {
            const l = extractLicense(license)
            if (l) {
                licenseTypes.push(l);
            }
        }
        return licenseTypes.length > 0 ? '(' + licenseTypes.join(' OR ') + ')' : undefined;
    }

    return undefined
}

function getWarningsNGSeverity(licenseTypes) {
    if (!licenseTypes) {
        return 'ERROR'
    }

    const spdxId = correct(licenseTypes)
    if (!spdxId) {
        return 'ERROR'
    }

    return isOSIApproved(spdxId) ? 'LOW' : 'HIGH'
}

function isRootDependency(packageName) {
    if (!packageName) {
        return false
    }

    if (packageJson.dependencies) {
        if (Object.keys(packageJson.dependencies).includes(packageName)) {
            return true
        }
    }

    if (packageJson.devDependencies) {
        if (Object.keys(packageJson.devDependencies).includes(packageName)) {
            return true
        }
    }

    return false
}

const dependencyTreeCache = {}

function getDependencyTree(packageName) {
    if (!packageName || packageName === '') {
        return []
    }

    let tree = [packageName];
    let parent = packageName
    let i = 1
    while (parent && !isRootDependency(parent) && i < 100) {
        if (dependencyTreeCache[parent]) {
            const result = [...tree, ...dependencyTreeCache[parent]]
            for (let i = 0; i < result.length; i++) {
                dependencyTreeCache[result[i]] = result.slice(i)
            }
            return result.reverse()
        }

        parent = Object.entries(packageLock.packages).filter(e => {
            if (e[1].dependencies) {
                return Object.keys(e[1].dependencies).includes(parent)
            }
            return false

        }).map(e => e[0].split('node_modules/').reverse()[0])[0] ?? undefined;

        if (parent) {
            tree.push(parent)
        }
    }

    for (let i = 0; i < tree.length; i++) {
        dependencyTreeCache[tree[i]] = tree.slice(i)
    }

    return tree.reverse();
}

function processPackageList(parentPath) {
    const parentList = fs.readdirSync(parentPath);
    for (const p of parentList) {
        if (p.startsWith('.') || !fs.lstatSync(path.join(parentPath, p)).isDirectory()) {
            continue;
        }
        if (p.startsWith('@')) {
            processPackageList(path.join(parentPath, p))
            continue;
        }

        processPackageDir(p, parentPath)
    }
}

function processPackageDir(packageName, packageParent) {
    const packageJsonPath = path.join(packageParent, packageName, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        const packageJsonData = JSON.parse(fs.readFileSync(packageJsonPath).toString())
        const licenseTypes = extractLicense(packageJsonData)
        const severity = getWarningsNGSeverity(licenseTypes)
        const dependencyTree = getDependencyTree(packageName)
        issues.push({
            packageName,
            type: licenseTypes ?? 'n/a',
            fileName: packageJsonPath,
            severity,
            message: 'Dependency tree',
            description: dependencyTree.join(' → ')
        });
    }
}

processPackageList('./node_modules')

fs.writeFileSync('./licenseReport.json', JSON.stringify({issues}))
