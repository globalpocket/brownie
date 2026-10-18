#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function validateImplementationPrActor(actor, expectedActor = 'brownie-agent') {
  const normalized = typeof actor === 'string' ? actor.trim() : '';
  if (!normalized) {
    return [`implementation PR creation requires authenticated GitHub actor ${expectedActor}; no actor was detected.`];
  }
  if (normalized !== expectedActor) {
    return [`implementation PR creation requires GitHub actor ${expectedActor}; got ${normalized}.`];
  }
  return [];
}

export function readAuthenticatedActor({ run = spawnSync } = {}) {
  const result = run('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    return { actor: '', error: result.stderr?.trim() || 'gh api user failed.' };
  }
  return { actor: result.stdout?.trim() || '', error: '' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const detected = readAuthenticatedActor();
  const errors = detected.error
    ? [`implementation PR creation could not verify GitHub actor: ${detected.error}`]
    : validateImplementationPrActor(detected.actor);
  if (errors.length > 0) {
    console.error('Implementation PR actor guard failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Implementation PR actor guard passed for ${detected.actor}.`);
}
