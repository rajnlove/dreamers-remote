import { ValidationError } from "../workstation/errors.js";
import { env } from "../config/env.js";

// Phase 4 (P4-2): structured job options only -- the PHP Projects site
// never sends a raw FFmpeg command line, and this repo never builds one
// from unvalidated input either (see agent/Dreamers.Agent.Core/Ffmpeg/
// FfmpegArgs.cs for the Agent-side whitelist that actually shapes the
// process arguments). This module is the server-side half of that same
// defense-in-depth: reject anything that isn't one of these exact enum
// values or a path under an allowed root before a job is even created.
export const FFMPEG_CODECS = ["h264_nvenc", "hevc_nvenc", "av1_nvenc"] as const;
export type FfmpegCodec = (typeof FFMPEG_CODECS)[number];

export const FFMPEG_QUALITY_MODES = ["cq", "vbr"] as const;
export type FfmpegQualityMode = (typeof FFMPEG_QUALITY_MODES)[number];

export const FFMPEG_PRESETS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"] as const;
export type FfmpegPreset = (typeof FFMPEG_PRESETS)[number];

export const FFMPEG_AUDIO_CODECS = ["aac", "copy", "none"] as const;
export type FfmpegAudioCodec = (typeof FFMPEG_AUDIO_CODECS)[number];

export interface FfmpegJobInput {
  projectId: string | null;
  sourcePath: string;
  outputPath: string;
  codec: FfmpegCodec;
  qualityMode: FfmpegQualityMode;
  quality: number | null;
  bitrate: string | null;
  preset: FfmpegPreset;
  resolution: string | null;
  audioCodec: FfmpegAudioCodec;
}

// UNC-path prefix check, case-insensitive (Windows paths), with an
// explicit `..` rejection so `\\nas\Projects\..\..\Windows\System32`
// can't walk itself out of an allowed root even though it technically
// starts with the right prefix as a raw string.
export function isPathUnderAllowedRoot(path: string, allowedRoots: readonly string[]): boolean {
  if (path.includes("..")) return false;
  const normalized = path.toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "");
  return allowedRoots.some((root) => {
    const normalizedRoot = root.toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "");
    return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + "\\");
  });
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function requirePath(value: unknown, field: string, allowedRoots: readonly string[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required and must be a non-empty string`);
  }
  if (!isPathUnderAllowedRoot(value, allowedRoots)) {
    throw new ValidationError(
      `${field} must be under a configured allowed root (FFMPEG_ALLOWED_ROOTS) -- got "${value}"`,
    );
  }
  return value;
}

// Parses+validates the JSON object a "ffmpeg" job's `input` field
// decodes to. Called from job/validation.ts's validateCreateInput, not
// standalone -- `input` on the wire is still always a JSON-encoded
// string like every other job type (see job/types.ts), this just adds
// a stricter shape check on top for this one known type. allowedRoots
// defaults to the real env config; overridable so tests don't depend on
// process.env.
export function validateFfmpegInput(raw: unknown, allowedRoots: readonly string[] = env.ffmpegAllowedRoots): FfmpegJobInput {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError("ffmpeg job input must be an object");
  }
  const b = raw as Record<string, unknown>;

  const sourcePath = requirePath(b.sourcePath, "sourcePath", allowedRoots);
  const outputPath = requirePath(b.outputPath, "outputPath", allowedRoots);
  const codec = requireEnum(b.codec, FFMPEG_CODECS, "codec");
  const qualityMode = requireEnum(b.qualityMode, FFMPEG_QUALITY_MODES, "qualityMode");

  let quality: number | null = null;
  if (b.quality !== undefined && b.quality !== null) {
    quality = Number(b.quality);
    if (!Number.isInteger(quality) || quality < 0 || quality > 51) {
      throw new ValidationError("quality must be an integer 0-51 (CQ/CRF-style scale)");
    }
  }

  let bitrate: string | null = null;
  if (b.bitrate !== undefined && b.bitrate !== null) {
    if (typeof b.bitrate !== "string" || !/^\d+[kKmM]$/.test(b.bitrate)) {
      throw new ValidationError('bitrate must be a string like "8M" or "8000k"');
    }
    bitrate = b.bitrate;
  }

  const preset = b.preset === undefined ? "p6" : requireEnum(b.preset, FFMPEG_PRESETS, "preset");

  let resolution: string | null = null;
  if (b.resolution !== undefined && b.resolution !== null) {
    if (typeof b.resolution !== "string" || !/^\d{2,5}x\d{2,5}$/.test(b.resolution)) {
      throw new ValidationError('resolution must be a string like "1920x1080"');
    }
    resolution = b.resolution;
  }

  const audioCodec = b.audioCodec === undefined ? "aac" : requireEnum(b.audioCodec, FFMPEG_AUDIO_CODECS, "audioCodec");

  let projectId: string | null = null;
  if (b.projectId !== undefined && b.projectId !== null) {
    if (typeof b.projectId !== "string" || b.projectId.trim().length === 0) {
      throw new ValidationError("projectId must be a non-empty string when provided");
    }
    projectId = b.projectId;
  }

  return { projectId, sourcePath, outputPath, codec, qualityMode, quality, bitrate, preset, resolution, audioCodec };
}
