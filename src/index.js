/* @flow */

import {stat, readFile} from 'fs-extra'
import {exec, spawn} from 'promisify-child-process'
import os from 'os'
import path from 'path'

type Options = {
  pkg: string,
  username: string,
  password: string,
  editor?: string,
  organizations?: Array<string>,
}

function stripScope(pkg: string): string {
  return pkg.substring(pkg.indexOf('/') + 1)
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory()
  } catch (error) {
    return false
  }
}

function parseRepoUrl(url: string): {owner: string, repo: string} {
  const result = /https:\/\/github.com\/([^\/.]+)\/([^\/.]+)/.exec(url)
  if (!result) throw new Error(`invalid Github URL: ${url}`)
  return {owner: result[1], repo: result[2]}
}

async function getPackageInDir(dir: string): Promise<?string> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).name
  } catch (error) {
    return null
  }
}

export default async function workOnRepo(options: Options): Promise<any> {
  const {pkg, username, password, organizations, editor} = options
  const pkgWithoutScope = stripScope(pkg)
  const workDir = path.join(os.homedir(), pkgWithoutScope)
  if (await directoryExists(workDir)) {
    const spawnOpts = {cwd: workDir, stdio: 'inherit'}
    await spawn('git', ['checkout', 'master'], spawnOpts)
    await spawn('git', ['pull', 'origin', 'master'], spawnOpts)
    await spawn('git', ['pull', 'upstream', 'master'], spawnOpts)
  } else {
    const octokit = require('@octokit/rest')()
    await octokit.authenticate({
      type: 'basic',
      username,
      password,
    })

    const repoUrl = (await exec(`npm view ${pkg} repository.url`)).stdout.trim()
    const {owner, repo} = parseRepoUrl(repoUrl)
    let forkOwner = username
    if (organizations) {
      for (let organization of organizations) {
        try {
          await octokit.activity.getEventsForRepo({owner: organization, repo})
          forkOwner = organization
          break
        } catch (error) {
          // ignore
        }
      }
    }
    if (forkOwner === username) {
      await octokit.repos.fork({owner, repo})
    }
    await spawn('git', ['clone', `https://github.com/${forkOwner}/${repo}.git`], {cwd: os.homedir(), stdio: 'inherit'})
    await spawn('git', ['remote', 'add', 'upstream', `https://github.com/${owner}/${repo}.git`], {cwd: workDir, stdio: 'inherit'})
  }
  // for lerna-style repos, find the subpackage folder
  let packageDir = workDir
  if (await getPackageInDir(workDir) !== pkg) {
    const packagesDir = path.join(workDir, 'packages')
    if (await directoryExists(packagesDir)) {
      for (let dir of packagesDir) {
        if (await getPackageInDir(dir) === pkg) {
          packageDir = dir
          break
        }
      }
    }
  }
  await spawn('yarn', ['--ignore-scripts'], {cwd: packageDir, stdio: 'inherit'})
  if (editor) spawn(editor, [packageDir], {cwd: packageDir, detached: true})
}
