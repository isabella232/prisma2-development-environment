import chalk from 'chalk'
import execa from 'execa'
import path from 'path'
import globby from 'globby'
import topo from 'batching-toposort'
import { promises as fs } from 'fs'
import arg from 'arg'
import pMap from 'p-map'
import semver from 'semver'
import pReduce from 'p-reduce'

export type Commit = {
  date: Date
  dir: string
  hash: string
  isMergeCommit: boolean
  parentCommits: string[]
}

async function getLatestChanges(
  allRepos: boolean,
  repo?: string,
  dirty?: boolean,
): Promise<string[]> {
  if (repo && !['prisma2', 'lift', 'photonjs']) {
    throw new Error(
      `Provided repo ${repo} does not exist. Please choose either prisma2, lift or photonjs.`,
    )
  }

  if (!dirty) {
    await Promise.all([
      ensureChangedAreSaved('prisma2'),
      ensureChangedAreSaved('lift'),
      ensureChangedAreSaved('photonjs'),
    ])
  }

  const commits = repo
    ? [await getLatestCommit(repo)]
    : await Promise.all([
        getLatestCommit('prisma2'),
        getLatestCommit('lift'),
        getLatestCommit('photonjs'),
      ])

  commits.sort((a, b) => {
    return a.date < b.date ? 1 : -1
  })

  if (allRepos) {
    return flatten(
      await Promise.all(commits.map(commit => getChangesFromCommit(commit))),
    )
  } else {
    const latestCommit = commits[0]

    return getChangesFromCommit(latestCommit)
  }
}

async function getChangesFromCommit(commit: Commit): Promise<string[]> {
  const hashes = commit.isMergeCommit
    ? commit.parentCommits.join(' ')
    : commit.hash
  const changes = await runResult(
    commit.dir,
    `git diff-tree --no-commit-id --name-only -r ${hashes}`,
  )
  if (changes.trim().length > 0) {
    return changes.split('\n').map(change => path.join(commit.dir, change))
  } else {
    throw new Error(`No changes detected. This must not happen!`)
  }
}

async function getUnsavedChanges(dir: string): Promise<string | null> {
  const result = await runResult(dir, `git status --porcelain`)
  return result.trim() || null
}

// if the current branch is ahead, we need to push it
async function getUnpushedCommitCount(dir: string): Promise<number> {
  const result = await runResult(dir, `git status --porcelain=v2 --branch`)
  const lines = result.split('\n')
  const abLine = lines.find(l => l.startsWith('# branch.ab'))

  if (abLine) {
    const regex = /branch\.ab\s\+(\d+)/
    const match = regex.exec(abLine)
    if (match) {
      return Number(match[1])
    }
  }

  return 0
}

async function ensureChangedAreSaved(dir: string): Promise<void> {
  const unsavedChanges = await getUnsavedChanges(dir)
  if (unsavedChanges) {
    // special rule needed, as version of prisma is changing when downloading
    if (dir === 'prisma2' && unsavedChanges === 'M cli/prisma2/package.json') {
      return
    }
    throw new Error(
      `${chalk.underline(
        dir,
      )} has unsaved changes. Before publishing, please commit them. Changes:\n\n${unsavedChanges}\n`,
    )
  }
}

async function getLatestCommit(dir: string): Promise<Commit> {
  const result = await runResult(
    dir,
    'git log --pretty=format:"%ad %H %P" --date=iso-strict -n 1',
  )
  const [date, commit, ...parents] = result.split(' ')

  return {
    date: new Date(date),
    dir,
    hash: commit,
    isMergeCommit: parents.length > 1,
    parentCommits: parents,
  }
}

async function commitChanges(
  dir: string,
  messages: string[],
  dry = false,
): Promise<void> {
  await run(
    dir,
    `git commit -a ${messages.map(m => `-m "${m}"`).join(' ')}`,
    dry,
  )
}

async function push(dir: string, dry = false): Promise<void> {
  if (process.env.BUILDKITE) {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error(`Missing env var GITHUB_TOKEN`)
    }
    const remotes = (await runResult(dir, `git remote`)).trim().split('\n')
    if (!remotes.includes('origin-push')) {
      await run(
        dir,
        `git remote add origin-push https://${process.env.GITHUB_TOKEN}@github.com/prisma/${dir}.git`,
        dry,
      )
    }
    await run(dir, `git push --quiet --set-upstream origin-push master`, dry)
  } else {
    await run(dir, `git push origin master`, dry)
  }
}

/**
 * Runs a command and returns the resulting stdout in a Promise.
 * @param cwd cwd for running the command
 * @param cmd command to run
 */
async function runResult(cwd: string, cmd: string): Promise<string> {
  try {
    const result = await execa.command(cmd, {
      cwd,
      stdio: 'pipe',
      shell: true,
    })
    return result.stdout
  } catch (e) {
    throw new Error(
      chalk.red(
        `Error running ${chalk.bold(cmd)} in ${chalk.underline(cwd)}:`,
      ) + (e.stderr || e.stack || e.message),
    )
  }
}

/**
 * Runs a command and pipes the stdout & stderr to the current process.
 * @param cwd cwd for running the command
 * @param cmd command to run
 */
async function run(
  cwd: string,
  cmd: string,
  dry: boolean = false,
): Promise<void> {
  const args = [chalk.underline('./' + cwd).padEnd(20), chalk.bold(cmd)]
  if (dry) {
    args.push(chalk.dim('(dry)'))
  }
  console.log(...args)
  if (dry) {
    return
  }

  try {
    await execa.command(cmd, {
      cwd,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        SKIP_GENERATE: 'true',
      },
    })
  } catch (e) {
    throw new Error(
      chalk.red(
        `Error running ${chalk.bold(cmd)} in ${chalk.underline(cwd)}:`,
      ) + (e.stderr || e.stack || e.message),
    )
  }
}

type RawPackage = {
  path: string
  packageJson: any
}
type RawPackages = { [packageName: string]: RawPackage }

export async function getPackages(): Promise<RawPackages> {
  const packagePaths = await globby(
    [
      'lift/package.json',
      'prisma2/cli/**/package.json',
      'photonjs/packages/**/package.json',
    ],
    {
      ignore: ['**/node_modules/**', '**/examples/**'],
    } as any, // TODO: Apparently upgrading to ts 3.7.2 broke this
  )
  const packages = await Promise.all(
    packagePaths.map(async p => ({
      path: p,
      packageJson: JSON.parse(await fs.readFile(p, 'utf-8')),
    })),
  )

  return packages.reduce<RawPackages>((acc, p: any) => {
    // TODO: Apparently upgrading to ts 3.7.2 broke this
    if (p.packageJson.name) {
      acc[p.packageJson.name] = p
    }
    return acc
  }, {})
}

interface Package {
  name: string
  path: string
  version: string
  usedBy: string[]
  usedByDev: string[]
  uses: string[]
  usesDev: string[]
  packageJson: any
}

interface ChangedPackage extends Package {
  newVersion: string
}

type Packages = { [packageName: string]: Package }
type ChangedPackages = { [packageName: string]: ChangedPackage }

export function getPackageDependencies(packages: RawPackages): Packages {
  const packageCache = Object.entries(packages).reduce<Packages>(
    (acc, [name, pkg]) => {
      acc[name] = {
        version: pkg.packageJson.version,
        name,
        path: pkg.path,
        usedBy: [],
        usedByDev: [],
        uses: getPrismaDependencies(pkg.packageJson.dependencies),
        usesDev: getPrismaDependencies(pkg.packageJson.devDependencies),
        packageJson: pkg.packageJson,
      }

      return acc
    },
    {},
  )

  for (const pkg of Object.values(packageCache)) {
    for (const dependency of pkg.uses) {
      if (packageCache[dependency]) {
        packageCache[dependency].usedBy.push(pkg.name)
      } else {
        console.info(`Skipping ${dependency} as it's not in this workspace`)
      }
    }
    for (const devDependency of pkg.usesDev) {
      if (packageCache[devDependency]) {
        packageCache[devDependency].usedByDev.push(pkg.name)
      } else {
        console.info(`Skipping ${devDependency} as it's not in this workspace`)
      }
    }
  }

  return packageCache
}

function getPrismaDependencies(dependencies?: {
  [name: string]: string
}): string[] {
  if (!dependencies) {
    return []
  }
  return Object.keys(dependencies).filter(
    d => d.startsWith('@prisma') && !d.startsWith('@prisma/studio'),
  )
}

function getCircularDependencies(packages: Packages): string[][] {
  const circularDeps = []
  for (const pkg of Object.values(packages)) {
    const uses = [...pkg.uses, ...pkg.usesDev]
    const usedBy = [...pkg.usedBy, ...pkg.usedByDev]
    const circles = intersection(uses, usedBy)
    if (circles.length > 0) {
      circularDeps.push(circles)
    }
  }

  return circularDeps
}

async function getPackagesAffectedByChange(
  packages: Packages,
  changes: string[],
  prisma2AndPhotonOnly: boolean,
  prisma2Version: string,
): Promise<ChangedPackages> {
  const changedPackages = prisma2AndPhotonOnly
    ? Object.values(packages).filter(p =>
        ['@prisma/photon', 'prisma2'].includes(p.name),
      )
    : Object.values(packages).filter(p =>
        changes.find(c => c.startsWith(path.dirname(p.path))),
      )

  const affectedPackages: Packages = changedPackages.reduce((acc, p) => {
    acc[p.name] = p
    return acc
  }, {})

  // If photon.js is not yet part of it, it has to
  // as we always need to release the same version of prisma2 and photonjs
  if (!affectedPackages['@prisma/photon']) {
    affectedPackages['@prisma/photon'] = packages['@prisma/photon']
  }

  function addDependants(pkg: Package) {
    for (const dependency of pkg.usedBy) {
      if (!affectedPackages[dependency]) {
        affectedPackages[dependency] = packages[dependency]
        addDependants(packages[dependency])
      }
    }
    for (const devDependency of pkg.usedByDev) {
      if (!affectedPackages[devDependency]) {
        affectedPackages[devDependency] = packages[devDependency]
        addDependants(packages[devDependency])
      }
    }
  }

  for (const pkg of Object.values(affectedPackages)) {
    addDependants(pkg)
  }

  return pReduce(
    Object.values(affectedPackages),
    async (acc, p) => {
      acc[p.name] = {
        ...p,
        newVersion: await newVersion(p, prisma2Version),
      }
      return acc
    },
    {},
  )
}

function getCommitMessages(dir: string, packages: Packages): string[] {
  return Object.values(packages)
    .sort((a, b) => {
      if (['@prisma/photon', 'prisma2'].includes(a.name)) {
        return -1
      }

      if (['@prisma/photon', 'prisma2'].includes(b.name)) {
        return 1
      }

      return a.name < b.name ? -1 : 1
    })
    .filter(p => p.path.startsWith(dir))
    .map(p => `${p.name}@${p.version}`)
}

export function getPublishOrder(packages: Packages): string[][] {
  const dag: { [pkg: string]: string[] } = Object.values(packages).reduce(
    (acc, curr) => {
      acc[curr.name] = [...curr.usedBy, ...curr.usedByDev]
      return acc
    },
    {},
  )

  return topo(dag)
}

/**
 * Takes the max alpha version + 1
 * For now supporting 2.0.0-alpha.X
 * @param packages Locla package definitions
 */
async function getNewPrisma2Version(packages: Packages): Promise<string> {
  const localPrisma2Version = packages['prisma2'].version
  const localPhotonVersion = packages['@prisma/photon'].version
  const [remotePrisma2Version, remotePhotonVersion] = await Promise.all([
    runResult('.', `npm info prisma2@alpha version`),
    runResult('.', `npm info @prisma/photon@alpha version`),
  ])

  const regex = /alpha\.(\d+)/

  const alphaVersions = [
    localPrisma2Version,
    localPhotonVersion,
    remotePrisma2Version,
    remotePhotonVersion,
  ]
    .filter(v => v.trim().length > 0)
    .map(v => {
      const match = regex.exec(v)
      if (match) {
        return Number(match[1])
      }
      return null
    })
    .filter(v => v)

  const maxAlpha = Math.max(...alphaVersions)

  return `2.0.0-alpha.${maxAlpha + 1}`
}

async function publish() {
  const args = arg({
    '--publish': Boolean,
    '--all-repos': Boolean,
    '--repo': String,
    '--dry-run': Boolean,
    '--release': String,
    '--dirty': Boolean,
    '--pull': Boolean,
    '--status': Boolean,
    '--test-changed': Boolean,
    '--test-all': Boolean,
  })

  if (
    process.env.BUILDKITE &&
    process.env.PUBLISH_BUILD &&
    !process.env.GITHUB_TOKEN
  ) {
    throw new Error(`Missing env var GITHUB_TOKEN`)
  }

  if (args['--pull']) {
    const repos = ['lift', 'photonjs', 'prisma2']
    for (const repo of repos) {
      console.log(`\nPulling ${chalk.cyanBright(repo)}`)
      await run(repo, `git pull origin master --no-edit`)
    }
    return
  }

  if (args['--status']) {
    const repos = ['lift', 'photonjs', 'prisma2']
    for (const repo of repos) {
      console.log(`\nStatus for ${chalk.cyanBright(repo)}`)
      await run(repo, `git status`)
    }
    return
  }

  if (args['--dry-run'] && args['--publish']) {
    throw new Error(
      `Can't use --dry-run and --publish at the same time. Please choose for either one or the other.`,
    )
  }

  if (process.env.BUILDKITE_TAG) {
    if (args['--release']) {
      throw new Error(
        `Can't provide env var BUILDKITE_TAG and --release at the same time`,
      )
    }

    console.log(
      `Setting --release to BUILDKITE_TAG = ${process.env.BUILDKITE_TAG}`,
    )
    args['--release'] = process.env.BUILDKITE_TAG
  }

  if (args['--release']) {
    if (!semver.valid(args['--release'])) {
      throw new Error(
        `New release version ${chalk.bold.underline(
          args['--release'],
        )} is not a valid semver version.`,
      )
    }
    const currentVersion = await runResult('.', 'npm info prisma2 version')
    if (!semver.gt(args['--release'], currentVersion)) {
      throw new Error(
        `New release version ${chalk.bold.underline(
          args['--release'],
        )} is not greater than the current semver version ${chalk.bold.underline(
          currentVersion,
        )}`,
      )
    }
    if (!args['--release'].includes('preview0')) {
      throw new Error(
        `New release version ${chalk.bold.underline(
          args['--release'],
        )} does not follow the preview naming scheme: ${chalk.bold.underline(
          '2.0.0-preview0XX',
        )}`,
      )
    }

    // If there is --release, it's always also --publish
    args['--publish'] = true
  }

  const rawPackages = await getPackages()
  const packages = getPackageDependencies(rawPackages)
  const circles = getCircularDependencies(packages)
  if (circles.length > 0) {
    throw new Error(`Oops, there are circular dependencies: ${circles}`)
  }

  const changes = await getLatestChanges(
    args['--all-repos'],
    args['--repo'],
    args['--dirty'] ||
      (!args['--publish'] && !args['--release'] && !args['--dry-run']),
  )

  if (!args['--publish'] && !args['--test-all']) {
    console.log(chalk.bold(`Changed files:`))
    console.log(changes.map(c => `  ${c}`).join('\n'))
  }
  const prisma2Version =
    args['--release'] || (await getNewPrisma2Version(packages))

  const changedPackages = await getPackagesAffectedByChange(
    packages,
    changes,
    Boolean(args['--release'] || process.env.UPDATE_STUDIO),
    prisma2Version,
  )

  if (process.env.UPDATE_STUDIO) {
    console.log(
      chalk.bold(
        `UPDATE_STUDIO is set, so we only update photon and all dependants.`,
      ),
    )
  }

  let publishOrder = getPublishOrder(
    args['--test-all'] ? packages : changedPackages,
  )

  if (
    !args['--dry-run'] &&
    (!args['--publish'] ||
      args['--test-changed'] ||
      args['--release'] ||
      args['--test-all'])
  ) {
    if (args['--test-all']) {
      console.log('Testing all')
    }
    await testPackages(
      args['--test-all'] ? packages : changedPackages,
      publishOrder,
    )
  }

  if (args['--publish'] || args['--dry-run']) {
    // We know, that Photon and Prisma2 are always part of the release.
    // Therefore, also lift is also always part of the release, as it depends on photon.
    // We can therefore safely update studio, as lift and prisma2 are depending on studio

    if (process.env.UPDATE_STUDIO) {
      const latestStudioVersion = await runResult(
        '.',
        'npm info @prisma/studio-transport version',
      )
      console.log(
        `UPDATE_STUDIO set true, so we're updating it to ${latestStudioVersion}`,
      )
      await run(
        '.',
        `pnpm update  -r @prisma/studio@${latestStudioVersion} @prisma/studio-transports@${latestStudioVersion} @prisma/studio-server@${latestStudioVersion}`,
      )
    }

    await publishPackages(
      packages,
      changedPackages,
      publishOrder,
      args['--dry-run'],
      prisma2Version,
      args['--release'],
    )
  }
}

/**
 * Tests packages in "publishOrder"
 * @param packages Packages
 * @param publishOrder string[][]
 */
async function testPackages(
  packages: Packages,
  publishOrder: string[][],
): Promise<void> {
  const order = flatten(publishOrder)
  console.log(chalk.bold(`\nRun ${chalk.cyanBright('tests')}. Testing order:`))
  console.log(order)
  for (const pkgName of order) {
    const pkg = packages[pkgName]
    if (pkg.packageJson.scripts.test) {
      console.log(`\nTesting ${chalk.magentaBright(pkg.name)}`)
      await run(path.dirname(pkg.path), 'pnpm run test')
    } else {
      console.log(
        `\nSkipping ${chalk.magentaBright(pkg.name)}, as it doesn't have tests`,
      )
    }
  }
}

function flatten<T>(arr: T[][]): T[] {
  return arr.reduce((acc, val) => acc.concat(val), [])
}

function intersection<T>(arr1: T[], arr2: T[]): T[] {
  return arr1.filter(value => arr2.includes(value))
}

// Parent "version updating function", uses `patch` and `patchVersion`
async function newVersion(pkg: Package, prisma2Version: string) {
  const isPrisma2OrPhoton = ['prisma2', '@prisma/photon'].includes(pkg.name)
  return isPrisma2OrPhoton ? prisma2Version : await patch(pkg)
}

function patchVersion(version: string): string | null {
  // Thanks 🙏 to https://github.com/semver/semver/issues/232#issuecomment-405596809
  const regex = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+(?<buildmetadata>[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

  const match = regex.exec(version)
  if (match) {
    return `${match.groups.major}.${match.groups.minor}.${Number(
      match.groups.patch,
    ) + 1}`
  }

  return null
}

async function patch(pkg: Package): Promise<string> {
  // if done locally, no need to get the latest version from npm (saves time)
  // if done in buildkite, we definitely want to check, if there's a newer version on npm
  // in buildkite, saving a few sec is not worth it
  if (!process.env.BUILDKITE) {
    return patchVersion(pkg.version)
  }

  const localVersion = pkg.version
  const npmVersion = await runResult('.', `npm info ${pkg.name} version`)

  const maxVersion = semver.maxSatisfying([localVersion, npmVersion], '*', {
    loose: true,
    includePrerelease: true,
  })

  return patchVersion(maxVersion)
}

async function publishPackages(
  packages: Packages,
  changedPackages: ChangedPackages,
  publishOrder: string[][],
  dryRun: boolean,
  prisma2Version: string,
  releaseVersion?: string,
): Promise<void> {
  // we need to release a new prisma2 cli in all cases.
  // if there is a change in photon, photon will also use this new version

  const publishStr = dryRun
    ? `${chalk.bold('Dry publish')} `
    : releaseVersion
    ? 'Releasing '
    : 'Publishing '

  if (releaseVersion) {
    console.log(
      chalk.red.bold(
        `RELEASE. This will release ${chalk.underline(
          releaseVersion,
        )} on latest!!!`,
      ),
    )
  }

  console.log(
    chalk.blueBright(
      `\n${publishStr}${chalk.bold(
        String(Object.values(changedPackages).length),
      )} packages. New prisma2 version: ${chalk.bold(
        prisma2Version,
      )}. Publish order:`,
    ),
  )
  console.log(
    chalk.blueBright(
      publishOrder.map((o, i) => `  ${i + 1}. ${o.join(', ')}`).join('\n'),
    ),
  )

  if (releaseVersion) {
    console.log(
      chalk.red.bold(
        `\nThis will ${chalk.underline(
          'release',
        )} a new version of prisma2 on latest: ${chalk.underline(
          prisma2Version,
        )}`,
      ),
    )
    if (!dryRun) {
      console.log(
        chalk.red(
          'Are you absolutely sure you want to do this? We wait for 10secs just in case...',
        ),
      )
      await new Promise(r => {
        setTimeout(r, 10000)
      })
    }
  } else if (!dryRun) {
    console.log(`\nGiving you 5sec to review the changes...`)
    await new Promise(r => {
      setTimeout(r, 5000)
    })
  }

  for (const currentBatch of publishOrder) {
    for (const pkgName of currentBatch) {
      // if (pkgName !== 'prisma2') {
      //   console.log(`Skipping ${pkgName}`)
      //   return
      // }
      const pkg = packages[pkgName]
      const pkgDir = path.dirname(pkg.path)
      const isPrisma2OrPhoton = ['prisma2', '@prisma/photon'].includes(pkgName)
      const tag =
        prisma2Version.includes('alpha') && isPrisma2OrPhoton
          ? 'alpha'
          : 'latest'
      const newVersion = isPrisma2OrPhoton ? prisma2Version : await patch(pkg)

      console.log(
        `\nPublishing ${chalk.magentaBright(
          `${pkgName}@${newVersion}`,
        )} ${chalk.dim(`on ${tag}`)}`,
      )

      const prismaDeps = [...pkg.uses, ...pkg.usesDev]
      if (prismaDeps.length > 0) {
        await run(
          pkgDir,
          `pnpm update ${prismaDeps.join(' ')} --filter "${pkgName}"`,
          dryRun,
        )
      }

      await run(
        pkgDir,
        `pnpm version --no-git-version ${newVersion} -f`,
        dryRun,
      )
      await run(pkgDir, `pnpm publish --tag ${tag}`, dryRun)
    }
  }

  // commit and push it :)
  const repos = ['lift', 'photonjs', 'prisma2']
  for (const repo of repos) {
    const messages = await getCommitMessages(repo, changedPackages)
    if (messages.length > 0) {
      // we try catch this, as this is not necessary for CI to succeed
      await run(repo, `git pull origin master --no-edit`)
      try {
        const unsavedChanges = await getUnsavedChanges(repo)
        if (!unsavedChanges) {
          console.log(
            `\n${chalk.bold(
              'Skipping',
            )} commiting changes of ${chalk.cyanBright(
              `./${repo}`,
            )} as they're already commited`,
          )
        } else {
          console.log(`\nCommiting changes of ${chalk.cyanBright(`./${repo}`)}`)
          await commitChanges(repo, messages, dryRun)
        }
        const unpushedCommitCount = await getUnpushedCommitCount(repo)
        if (unpushedCommitCount === 0) {
          console.log(
            `${chalk.bold('Skipping')} pushing commits of ${chalk.cyanBright(
              `./${repo}`,
            )} as they're already pushed`,
          )
        } else {
          console.log(
            `There are ${unpushedCommitCount} unpushed local commits in ${chalk.cyanBright(
              `./${repo}`,
            )}`,
          )
          await push(repo, dryRun)
        }
      } catch (e) {
        console.error(e)
        console.error(`Ignoring this error, continuing`)
      }
    }
  }
}

async function getCurrentVersion(
  packages: Packages,
  pkgName: string,
): Promise<string> {
  if (!packages[pkgName]) {
    throw new Error(`Could not find package ${pkgName}`)
  }
  const file = await fs.readFile(packages[pkgName].path, 'utf-8')
  const packageJson = JSON.parse(file)
  return packageJson.version
}

if (!module.parent) {
  publish().catch(e => {
    console.error(chalk.red.bold('Error: ') + (e.stack || e.message))
    process.exit(1)
  })
}
