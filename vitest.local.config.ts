import { mergeConfig, defineConfig } from 'vitest/config';
import base from './vitest.config.ts';
export default defineConfig(async env => mergeConfig(await base(env), {resolve:{preserveSymlinks:true}}));
