import { describe, expect, test } from 'bun:test';
import { resolveProjectForSessionDirectory } from './projectResolution';

const projects = [
  { id: 'noatinwork', path: '/workspace/noatinwork', label: 'NoatinWork' },
];

describe('resolveProjectForSessionDirectory', () => {
  test('resolves a sibling worktree to its registered project', () => {
    const worktrees = new Map([
      ['/workspace/noatinwork', [{
        path: '/workspace/noatinwork-feature',
        projectDirectory: '/workspace/noatinwork',
        branch: 'feature',
        label: 'feature',
      }]],
    ]);

    expect(resolveProjectForSessionDirectory(projects, worktrees, '/workspace/noatinwork-feature')).toEqual(projects[0]);
  });
});
