import execa from 'execa'
import chalk from 'chalk'
import Debug from 'debug'
import fs from 'fs'
import path from 'path'
import pMap from 'p-map'
import del from 'del'
import {
  getPackages,
  getPublishOrder,
  getPackageDependencies,
} from './ci/publish'
Debug.enable('setup')
const debug = Debug('setup')

async function main() {
  debug(`Cloning/Pulling all three main repos`)
  await Promise.all([
    cloneOrPull('lift'),
    cloneOrPull('photonjs'),
    cloneOrPull('prisma2'),
  ])

  debug(`Installing dependencies, building packages`)

  const rawPackages = await getPackages()
  const packages = getPackageDependencies(rawPackages)
  const publishOrder = getPublishOrder(packages)

  console.log(publishOrder)

  await run('.', `pnpm i -r --ignore-scripts`).catch(e => {})
  for (const batch of publishOrder) {
    for (const pkgName of batch) {
      const pkg = packages[pkgName]
      const pkgDir = path.dirname(pkg.path)
      await run(pkgDir, 'pnpm run build')
    }
  }

  // final install on top level
  await run('.', 'pnpm i -r')
}

main().catch(console.error)

function cloneOrPull(repo: string) {
  if (fs.existsSync(path.join(__dirname, '../', repo))) {
    return run(repo, `git pull origin master`)
  } else {
    return run('.', `git clone --depth=1 ${repoUrl(repo)}`)
  }
}

function repoUrl(repo: string, org: string = 'prisma') {
  return `https://github.com/${org}/${repo}.git`
}

export async function run(cwd: string, cmd: string): Promise<void> {
  debug(chalk.underline('./' + cwd).padEnd(20), chalk.bold(cmd))
  try {
    await execa.command(cmd, {
      cwd,
      stdio: 'inherit',
    })
  } catch (e) {
    throw new Error(
      chalk.bold.red(
        `Error running ${chalk.bold(cmd)} in ${chalk.underline(cwd)}:`,
      ) + (e.stack || e.message),
    )
  }
}
