/**
 * Centralized type aliases for `@rhwp/core` instances.
 *
 * Before chunk 100 (Phase 6.0), `type RhwpDoc = InstanceType<typeof HwpDocument>`
 * was duplicated across 8 hook files. This module is the single source of
 * truth — when the lib renames or restructures its export, only this file
 * needs to update.
 */
import type { HwpDocument, HwpViewer } from '@rhwp/core';

export type RhwpDoc = InstanceType<typeof HwpDocument>;
export type RhwpViewer = InstanceType<typeof HwpViewer>;
