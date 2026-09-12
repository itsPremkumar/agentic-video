import { definePlugin } from '../../core/define.ts';
import { S, resolveOutPath } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * delivery.archive - archive a published deliverable to a cold-storage folder.
 *
 * Reads the most-recently-published manifest under <deliveriesRoot>/<projectId>/
 * and moves that version's folder into <archiveRoot>/<projectId>/<version>-<timestamp>.
 *
 * Use case: keep the last 2-3 publishes hot in "deliveries" and move the rest to archive.
 */
export default definePlugin({
    id: 'delivery.archive',
    name: 'Move a published version to cold-storage archive',
    category: 'distribute',
    description:
        'Reads the current published version under <deliveriesRoot>/<projectId>/, moves that version folder into <archiveRoot>/<projectId>/<version>-<timestamp>.',
    inputs: {
        projectId: S.string('Project identifier', { required: true }),
        version: S.string('Version tag to archive (default: current LATEST)', { default: '' }),
        deliveriesRoot: S.string('Deliveries root (where published files live)', { default: 'deliveries' }),
        archiveRoot: S.string('Archive root (where to move old versions)', { default: 'archive' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const projectId = String(input.projectId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
        const deliveriesRoot = resolveOutPath(ctx, String(input.deliveriesRoot ?? 'deliveries'));
        const archiveRoot = resolveOutPath(ctx, String(input.archiveRoot ?? 'archive'));

        // Read LATEST marker if version empty.
        let version = String(input.version ?? '').trim();
        if (!version) {
            try {
                const buf = await fs.readFile(path.join(deliveriesRoot, projectId, 'LATEST'), 'utf8');
                version = buf.trim().split('\n')[0];
            } catch {
                return { outputs: [], warnings: ['No LATEST marker found for project "' + projectId + '".'] };
            }
        }
        if (!version) {
            return { outputs: [], warnings: ['Empty version tag.'] };
        }

        const sourceDir = path.join(deliveriesRoot, projectId, version);
        try { await fs.access(sourceDir); } catch {
            return { outputs: [], warnings: ['Version "' + version + '" not found under "' + sourceDir + '".'] };
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const targetDir = path.join(archiveRoot, projectId, version + '-' + stamp);
        await fs.mkdir(targetDir, { recursive: true });

        // Move all files (and MANIFEST.json) over.
        const entries = await fs.readdir(sourceDir, { withFileTypes: true });
        const moved: string[] = [];
        for (const e of entries) {
            if (!e.isFile()) continue;
            const src = path.join(sourceDir, e.name);
            const dst = path.join(targetDir, e.name);
            await fs.rename(src, dst);
            moved.push(dst);
        }

        // Append an entry to the project's archive log.
        const logPath = path.join(archiveRoot, projectId, 'archive.log.json');
        let log: any[] = [];
        try { log = JSON.parse(await fs.readFile(logPath, 'utf8')); } catch { log = []; }
        log.push({ version, archivedAt: new Date().toISOString(), files: moved });
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');

        return {
            outputs: [{ path: targetDir, kind: 'video' as const, meta: { projectId, version, archived: moved.length } }],
        };
    },
});