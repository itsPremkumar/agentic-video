import { definePlugin } from '../../core/define.ts';
import { S, requireFile, ensureParentDir, resolveOutPath } from '../_shared/common.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * delivery.publish - move a media file to a "published" location with manifest.
 *
 * Inputs:
 *   file      - source file
 *   projectId - human-readable project (e.g. "ocean-reel")
 *   version   - semver-like tag, e.g. "v1.0" (default "v1.0")
 *   outDir    - base delivery directory (e.g. "./deliveries")
 *
 * Output:
 *   <outDir>/<projectId>/<version>/<basename>
 *   <outDir>/<projectId>/<version>/MANIFEST.json  (sha1, size, timestamp)
 *   <outDir>/<projectId>/LATEST                   (symlink text to current version)
 *
 * Idempotent: re-running with the same version overwrites.
 */
export default definePlugin({
    id: 'delivery.publish',
    name: 'Publish a media file with a versioned manifest',
    category: 'distribute',
    description:
        'Copies a file to <outDir>/<projectId>/<version>/<basename>, writes a MANIFEST.json (sha1, size, mtime), and updates <projectId>/LATEST to point to the current version.',
    inputs: {
        file: S.string('Source media file', { required: true }),
        projectId: S.string('Project identifier', { required: true }),
        version: S.string('Version tag (e.g. v1.0)', { default: 'v1.0' }),
        outDir: S.string('Delivery base directory', { default: 'deliveries' }),
        notes: S.string('Free-form notes for the manifest', { default: '' }),
    },
    outputs: ['video'],
    async run({ input, ctx }) {
        const file = requireFile(String(input.file ?? ''), 'file');
        const projectId = String(input.projectId ?? 'untitled').replace(/[^a-zA-Z0-9._-]/g, '_');
        const version = String(input.version ?? 'v1.0').replace(/[^a-zA-Z0-9._-]/g, '_');
        const outDir = resolveOutPath(ctx, String(input.outDir ?? 'deliveries'));
        const notes = String(input.notes ?? '');

        const targetDir = path.join(outDir, projectId, version);
        ensureParentDir(targetDir + '/.keep');
        const target = path.join(targetDir, path.basename(file));
        await fs.copyFile(file, target);

        const stat = await fs.stat(target);
        const buf = await fs.readFile(target);
        const sha1 = crypto.createHash('sha1').update(buf).digest('hex');

        const manifest = {
            projectId,
            version,
            file: path.basename(target),
            path: target,
            sizeBytes: stat.size,
            sha1,
            mtime: stat.mtime.toISOString(),
            ctime: stat.ctime.toISOString(),
            notes,
            publishedAt: new Date().toISOString(),
        };
        const manifestPath = path.join(targetDir, 'MANIFEST.json');
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

        // LATEST marker file.
        const latestPath = path.join(outDir, projectId, 'LATEST');
        await fs.writeFile(latestPath, version + '\n', 'utf8');

        return {
            outputs: [{
                path: target,
                kind: 'video' as const,
                meta: { sha1, sizeBytes: stat.size, version, projectId, manifestPath },
            }],
        };
    },
});