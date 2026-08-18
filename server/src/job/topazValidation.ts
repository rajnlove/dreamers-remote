import { ValidationError } from "../workstation/errors.js";
import { env } from "../config/env.js";
import {
  FFMPEG_CODECS,
  FFMPEG_QUALITY_MODES,
  FFMPEG_PRESETS,
  FFMPEG_AUDIO_CODECS,
  type FfmpegCodec,
  type FfmpegQualityMode,
  type FfmpegPreset,
  type FfmpegAudioCodec,
  requireEnum,
  requirePath,
} from "./ffmpegValidation.js";

// Phase 4 (P4-4): mirrors ffmpegValidation.ts -- structured job options
// only, never a raw command line (see agent/Dreamers.Agent.Core/Topaz/
// TopazArgs.cs for the Agent-side whitelist that actually shapes the
// process arguments). v1 scope is upscale only ("tvai_up" -- see
// docs/ROADMAP.md); frame interpolation/stabilization are deferred.
//
// model is NOT a fixed enum, unlike codec/preset -- Topaz's upscale
// models change with app updates, so a hardcoded list would go stale
// and block legitimate new models. It still feeds into an ffmpeg
// filter-graph expression on the Agent side, so it's restricted to
// Topaz's actual naming convention (lowercase alphanumeric + dash) to
// block filter-graph-syntax characters (':'/','/';') from being
// injected into that expression -- same reasoning as TopazArgs.cs's
// ModelPattern, kept in sync with it by hand (there's no shared file
// between the TS and C# codebases to import a regex from).
const TOPAZ_MODEL_PATTERN = /^[a-z0-9-]{1,32}$/;
const TOPAZ_SCALE_MIN = 1;
const TOPAZ_SCALE_MAX = 4;

export interface TopazJobInput {
  projectId: string | null;
  sourcePath: string;
  outputPath: string;
  model: string;
  scale: number;
  codec: FfmpegCodec;
  qualityMode: FfmpegQualityMode;
  quality: number | null;
  bitrate: string | null;
  preset: FfmpegPreset;
  audioCodec: FfmpegAudioCodec;
}

// Parses+validates the JSON object a "topaz" job's `input` field
// decodes to. Called from job/validation.ts's validateCreateInput, same
// pattern as validateFfmpegInput. allowedRoots reuses the same
// FFMPEG_ALLOWED_ROOTS env var/config as ffmpeg jobs -- both are "NAS
// roots this server may point a job at", not literally ffmpeg-specific
// in what they check, so a second TOPAZ_ALLOWED_ROOTS would just be an
// unnecessary second config to keep in sync across deployments.
export function validateTopazInput(raw: unknown, allowedRoots: readonly string[] = env.ffmpegAllowedRoots): TopazJobInput {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError("topaz job input must be an object");
  }
  const b = raw as Record<string, unknown>;

  const sourcePath = requirePath(b.sourcePath, "sourcePath", allowedRoots);
  const outputPath = requirePath(b.outputPath, "outputPath", allowedRoots);

  if (typeof b.model !== "string" || !TOPAZ_MODEL_PATTERN.test(b.model)) {
    throw new ValidationError('model must match ^[a-z0-9-]{1,32}$ (e.g. "iris-2")');
  }
  const model = b.model;

  const scale = Number(b.scale);
  if (!Number.isInteger(scale) || scale < TOPAZ_SCALE_MIN || scale > TOPAZ_SCALE_MAX) {
    throw new ValidationError(`scale must be an integer ${TOPAZ_SCALE_MIN}-${TOPAZ_SCALE_MAX}`);
  }

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
  const audioCodec = b.audioCodec === undefined ? "aac" : requireEnum(b.audioCodec, FFMPEG_AUDIO_CODECS, "audioCodec");

  let projectId: string | null = null;
  if (b.projectId !== undefined && b.projectId !== null) {
    if (typeof b.projectId !== "string" || b.projectId.trim().length === 0) {
      throw new ValidationError("projectId must be a non-empty string when provided");
    }
    projectId = b.projectId;
  }

  return { projectId, sourcePath, outputPath, model, scale, codec, qualityMode, quality, bitrate, preset, audioCodec };
}
