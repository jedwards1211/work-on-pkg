/* @flow */

import {stat} from 'fs-extra'
import {exec} from 'promisify-child-process'
import os from 'os'
import path from 'path'

type Options = {
  pkg: string,
  username: string,
  password: string,
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

export default async function workOnRepo(options: Options): Promise<any> {
  const {pkg, username, password, organizations} = options
  const pkgWithoutScope = stripScope(pkg)
  const workDir = path.join(os.homedir(), pkgWithoutScope)
  if (await directoryExists(workDir)) {
    /* eslint-disable no-console */
    console.log(`cd ${workDir}`)
    console.log(`git checkout master`)
    console.log(`git pull origin master`)
    console.log(`git pull upstream master`)
    console.log(`subl .`)
    /* eslint-enable no-console */
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
    } else {
      await octokit.repos.fork({owner, repo, organization: forkOwner})
    }
    /* eslint-disable no-console */
    console.log(`cd ${os.homedir()}`)
    console.log(`git clone https://github.com/${forkOwner}/${repo}.git`)
    console.log(`cd ${repo}`)
    console.log(`git remote add upstream https://github.com/${owner}/${repo}.git`)
    console.log(`yarn --ignore-scripts`)
    console.log(`subl .`)
    /* eslint-enable no-console */
  }
}
