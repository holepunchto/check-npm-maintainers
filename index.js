#!/usr/bin/env node
const fs = require('fs').promises
const { command, flag, arg } = require('paparam')
const { spawnSync, execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

const DEFAULT_MODE = 'all'
const DEFAULT_KEY_OWNERS = 'mafintosh' // comma separated
const DEFAULT_OWNERS_FILE = 'owners.txt' // line separated

const cmd = command(
  'check-npm-maintainers',
  flag('--mode <mode>', `Packages to check, all or prod only (default: ${DEFAULT_MODE})`),
  flag('--key-owner <username>', `Key owners (default: ${DEFAULT_KEY_OWNERS})`).multiple(),
  arg('[owners]', `Trusted owners (default: ${DEFAULT_OWNERS_FILE})`),
  run
)

async function run({ flags, args }) {
  const mode = flags.mode || DEFAULT_MODE
  const keyOwners = flags.keyOwner?.length ? flags.keyOwner : DEFAULT_KEY_OWNERS.split(',')
  const ownersFile = args.owners || DEFAULT_OWNERS_FILE

  const trustedOwners = (await fs.readFile(ownersFile, 'utf-8')).split('\n').filter(Boolean)

  const allMaintainers = await extractMaintainers(mode)
  await checkMaintainers(allMaintainers, keyOwners, trustedOwners)
}

async function checkMaintainers(allMaintainers, keyOwners, trustedOwners) {
  const missingKeyOwnerPkgs = []
  const expiredOwnerPkgs = []
  const externalOwnerPkgs = []

  Object.entries(allMaintainers).forEach(([pkg, owners]) => {
    if (!owners.length || owners[0] === 'Unknown') return

    const names = owners.map((item) => item.split(' ')[0]) // to handle "name <email>" format
    const missingKeyOwner = checkMissingKeyOwner(keyOwners, trustedOwners, names)
    if (missingKeyOwner) missingKeyOwnerPkgs.push({ pkg, owners, names })

    const expiredOwners = checkExpiredOwners(keyOwners, trustedOwners, names)
    if (expiredOwners.length) expiredOwnerPkgs.push({ pkg, owners, names, expiredOwners })

    const isExternal = names.every(
      (name) => !keyOwners.includes(name) && !trustedOwners.includes(name)
    )
    if (isExternal) externalOwnerPkgs.push({ pkg, owners, names })
  })

  printResult(
    `Found ${missingKeyOwnerPkgs.length} packages missing key owner (${keyOwners.join(', ')})`,
    missingKeyOwnerPkgs.map((item) => `${item.pkg} [${item.names.join(', ')}]`)
  )

  printResult(
    `Found ${expiredOwnerPkgs.length} packages with expired owners`,
    expiredOwnerPkgs.map(
      (item) => `${item.pkg} [${item.names.join(', ')}] (expired ${item.expiredOwners.join(', ')})`
    )
  )

  printResult('Expired owners across all packages', [
    ...new Set(expiredOwnerPkgs.flatMap((item) => item.expiredOwners))
  ])

  printResult(
    `Found ${externalOwnerPkgs.length} packages owned entirely by external maintainers`,
    externalOwnerPkgs.map((item) => `${item.pkg} [${item.names.join(', ')}]`)
  )
}

function printResult(title, items) {
  console.log()
  console.log(`# ${title}`)
  console.log(items.length ? items.join('\n') : 'N/A')
  console.log()
}

function checkMissingKeyOwner(keyOwners, trustedOwners, names) {
  if (names.some((name) => keyOwners.includes(name))) return false
  return names.some((name) => trustedOwners.includes(name))
}

function checkExpiredOwners(keyOwners, trustedOwners, names) {
  const isOurPkg = names.some((name) => keyOwners.includes(name) || trustedOwners.includes(name))
  if (!isOurPkg) return []
  return names.filter((name) => !keyOwners.includes(name) && !trustedOwners.includes(name))
}

async function extractMaintainers(mode) {
  const npmTree = getNpmTree(mode)
  const allPackages = Array.from(collectAllDeps(npmTree)).sort()
  console.log(`Found ${allPackages.length} packages...`)

  const allMaintainers = {}
  let done = 0
  const concurrency = 16
  const queue = [...allPackages]

  async function worker() {
    while (queue.length) {
      const pkg = queue.shift()
      const maintainers = await getMaintainers(pkg)
      allMaintainers[pkg] = maintainers
      done++
      console.log(`${done}/${allPackages.length}`, pkg, maintainers)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))

  return allMaintainers
}

function getNpmTree(mode) {
  const args = ['ls', '--all', '--json']
  if (mode === 'prod') args.push('--omit=dev')
  const lsResult = spawnSync('npm', args, { encoding: 'utf-8' })
  if (lsResult.error || lsResult.status !== 0) {
    console.error('npm ls failed:', lsResult.stderr || lsResult.error)
    process.exit(1)
  }
  const npmTree = JSON.parse(lsResult.stdout)
  return npmTree
}

function collectAllDeps(tree, results = new Set()) {
  if (!tree.dependencies) return results
  for (const [name, details] of Object.entries(tree.dependencies)) {
    results.add(name)
    collectAllDeps(details, results)
  }
  return results
}

async function getMaintainers(pkg) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', pkg, 'maintainers', '--json'])
    const parsed = JSON.parse(stdout)
    if (Array.isArray(parsed)) {
      return parsed.map((x) => x.name || x)
    } else if (typeof parsed === 'string') {
      return [parsed]
    }
    return ['Unknown']
  } catch (e) {
    return ['Unknown']
  }
}

cmd.parse()
