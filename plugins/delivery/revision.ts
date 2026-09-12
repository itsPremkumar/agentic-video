import { definePlugin } from '../../core/define.ts';
import { S, requireFile, ensureParentDir, resolveOutPath } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * delivery.revision - create a new published revision of an existing deliverable.
 *
 * Reads the latest MANIFEST.json under <deliveriesRoot>/<projectId>/, increments
 * the patch version (v1.0 -> v1.1, v1.1 -> v1.2, etc.), and publishes the new
 * source file as that incremented version.
 *
 * Used by the agent to fix one render without bumping the whole release.
 */
export default definePlugin({
    id: 'delivery.revision',
    name: 'Publish a new patch revision of an existing project',
    category: 'distribute',
    description:
        'Bumps the patch component of the project\'s current version (v1.0 -> v1.1) and publishes the new file under that version tag. Reads LATEST marker to find the current version.',
    inputs: {
        file: S.string('New source media file', { required: true }),
        projectId: S.string('Project identifier', { required: true }),
        deliveriesRoot: S.string('Deliveries root', { default: 'deliveries' }),
        notes: S.string('Notes for the new revision', { default: '' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(String(input.file ?? ''), 'file');
        const projectId = String(input.projectId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
        const deliveriesRoot = resolveOutPath(ctx, String(input.deliveriesRoot ?? 'deliveries'));
        const notes = String(input.notes ?? '');

        const projectDir = path.join(deliveriesRoot, projectId);
        let currentVersion = 'v1.0';
        try {
            const buf = await fs.readFile(path.join(projectDir, 'LATEST'), 'utf8');
            const v = buf.trim().split('\n')[0];
            if (v) currentVersion = v;
        } catch { /* fresh project */ }

        // Parse vX.Y -> bump Y
        const m = /^v(\d+)\.(\d+)$/i.exec(currentVersion);
        let nextVersion = currentVersion + '-rev';
        if (m) {
            nextVersion = 'v' + m[1] + '.' + (Number(m[2]) + 1);
        }

        const targetDir = path.join(projectDir, nextVersion);
        ensureParentDir(targetDir + '/.keep');
        const target = path.join(targetDir, path.basename(file));
        await fs.copyFile(file, target);

        const stat = await fs.stat(target);
        const buf = await fs.readFile(target);
        const sha1 = crypto.createHash('sha1').update(buf).digest('hex');

        const manifest = {
            projectId,
            version: nextVersion,
            previousVersion: currentVersion,
            file: path.basename(target),
            path: target,
            sizeBytes: stat.size,
            sha1,
            mtime: stat.mtime.toISOString(),
            notes,
            publishedAt: new Date().toISOString(),
        };
        const manifestPath = path.join(targetDir, 'MANIFEST.json');
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        await fs.writeFile(path.join(projectDir, 'LATEST'), nextVersion + '\n', 'utf8');

        return {
            outputs: [{ path: target, kind: 'video' as const, meta: { version: nextVersion, previousVersion: currentVersion, sha1 } }],
        };
    },
});