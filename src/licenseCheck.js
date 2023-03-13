const fs = require('fs')
const path = require('path')
const isOSIApproved = require('spdx-is-osi')
const correct = require('spdx-correct')

const nodeModulesPath = './node_modules'
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
            const l = extractLicense({license})
            if (l) {
                licenseTypes.push(l)
            }
        }
        if (licenseTypes.length === 1) {
            return licenseTypes[0]
        }
        if (licenseTypes.length > 1) {
            return '('  + licenseTypes.join(' OR ') + ')'
        }
    }

    return undefined
}

const positiveList = ['CC0-1.0', 'CC-BY-4.0', 'Unlicense']

function isOnPositiveList(licenseType) {
    return positiveList.includes(licenseType)
}

function getWarningsNGSeverity(licenseType) {
    if (!licenseType) {
        return 'HIGH'
    }

    const spdxId = correct(licenseType)
    if (!spdxId) {
        if (isOnPositiveList) {
            return 'NORMAL'
        }

        return 'HIGH'
    }

    if (isOSIApproved(spdxId)) {
        return 'LOW'
    }

    if (isOnPositiveList) {
        return 'NORMAL'
    }

    return 'ERROR'
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

    let tree = [packageName]
    let parent = packageName
    let i = 1
    while (parent && !isRootDependency(parent) && i < 100) {
        if (dependencyTreeCache[parent]) {
            const result = [...tree, ...dependencyTreeCache[parent]]
            for (let j = 0; j < result.length; j++) {
                dependencyTreeCache[result[j]] = result.slice(j)
            }
            return result.reverse()
        }

        parent = Object.entries(packageLock.packages).filter(e => {
            if (e[1].dependencies) {
                return Object.keys(e[1].dependencies).includes(parent)
            }
            return false

        }).map(e => e[0].split('node_modules/').reverse()[0])[0] ?? undefined

        if (parent) {
            tree.push(parent)
        }
    }

    for (let j = 0; j < tree.length; j++) {
        dependencyTreeCache[tree[j]] = tree.slice(j)
    }

    return tree.reverse()
}

function getLineNumber(packageJsonRaw) {
    let i = 1
    const lines = packageJsonRaw.split('\n')
    for (const line of lines) {
        if (line.includes('"license"') || line.includes('"licenses"')) {
            return i
        }
        i++
    }
    return undefined
}

function processPackages() {
    const parentList = fs.readdirSync(nodeModulesPath)
    for (const packageName of parentList) {
        if (packageName.startsWith('.') || !fs.lstatSync(path.join(nodeModulesPath, packageName)).isDirectory()) {
            continue
        }
        if (packageName.startsWith('@')) {
            if (packageName.startsWith('@types')) {
                continue
            }
            const namespaceParentList = fs.readdirSync(path.join(nodeModulesPath, packageName))
            for (const namespacePackageName of namespaceParentList) {
                if (
                    packageName.startsWith('.') ||
                    !fs.lstatSync(path.join(nodeModulesPath, packageName, namespacePackageName)).isDirectory())
                {
                    continue
                }
                processPackageDir(path.join(packageName, namespacePackageName))
            }
            continue
        }

        processPackageDir(packageName)
    }
}

function processPackageDir(packageName) {
    const packageJsonPath = path.join(nodeModulesPath, packageName, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
        const packageJsonRaw = fs.readFileSync(packageJsonPath).toString()
        const packageJsonData = JSON.parse(packageJsonRaw)
        const licenseType = extractLicense(packageJsonData)
        const severity = getWarningsNGSeverity(licenseType)
        const dependencyTree = getDependencyTree(packageName)
        issues.push({
            packageName,
            type: licenseType ?? 'n/a',
            fileName: packageJsonPath,
            lineStart: getLineNumber(packageJsonRaw),
            severity,
            message: 'Dependency tree',
            description: dependencyTree.join(' → ')
        })
    }
}

processPackages()

fs.writeFileSync('./licenseReport.json', JSON.stringify({issues},  null, 2))
