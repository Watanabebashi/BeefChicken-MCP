#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();

const { main } = await import('../src/stdio.ts');

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
