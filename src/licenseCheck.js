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
        return 'ERROR'
    }

    const spdxId = correct(licenseType)
    if (!spdxId) {
        if (isOnPositiveList) {
            return 'NORMAL'
        }

        return 'ERROR'
    }

    if (isOSIApproved(spdxId)) {
        return 'LOW'
    }

    if (isOnPositiveList) {
        return 'NORMAL'
    }

    return 'HIGH'
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

        }).map(e => e[0].split('node_modules/').reverse()[0])[0] ?? undefined

        if (parent) {
            tree.push(parent)
        }
    }

    for (let i = 0; i < tree.length; i++) {
        dependencyTreeCache[tree[i]] = tree.slice(i)
    }

    return tree.reverse()
}

function processPackageList(parentPath) {
    const parentList = fs.readdirSync(parentPath)
    for (const p of parentList) {
        if (p.startsWith('.') || !fs.lstatSync(path.join(parentPath, p)).isDirectory()) {
            continue
        }
        if (p.startsWith('@')) {
            if (p.startsWith('@types')) {
                continue
            }
            processPackageList(path.join(parentPath, p))
            continue
        }

        processPackageDir(p, parentPath)
    }
}

function processPackageDir(packageName, packageParent) {
    const packageJsonPath = path.join(packageParent, packageName, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
        const packageJsonData = JSON.parse(fs.readFileSync(packageJsonPath).toString())
        const licenseType = extractLicense(packageJsonData)
        const severity = getWarningsNGSeverity(licenseType)
        const dependencyTree = getDependencyTree(packageName)
        issues.push({
            packageName,
            type: licenseType ?? 'n/a',
            fileName: packageJsonPath,
            severity,
            message: 'Dependency tree',
            description: dependencyTree.join(' → ')
        })
    }
}

processPackageList('./node_modules')

fs.writeFileSync('./licenseReport.json', JSON.stringify({issues}))
