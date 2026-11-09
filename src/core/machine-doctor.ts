import { z } from 'zod';
import { VERSION } from '../version';

const harnessCommands: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  kiro: 'kiro-cli',
  gemini: 'gemini',
  opencode: 'opencode',
  antigravity: 'agy',
  grok: 'grok',
};

const DoctorSchema = z.object({
  rigshelf: z.string().max(50),
  platform: z.string().max(50),
  harnesses: z.record(z.string().max(40), z.boolean()),
});
export type MachineDoctor = z.infer<typeof DoctorSchema>;

export function parseMachineDoctor(text: string): MachineDoctor {
  return DoctorSchema.parse(z.object({ here: z.unknown() }).parse(JSON.parse(text)).here);
}

export function machineDoctor(): MachineDoctor {
  return {
    rigshelf: VERSION,
    platform: `${process.platform}-${process.arch}`,
    harnesses: Object.fromEntries(
      Object.entries(harnessCommands).map(([harness, command]) => [
        harness,
        Boolean(Bun.which(command)),
      ]),
    ),
  };
}
