namespace Dreamers.Agent.Core.Configuration;

/// <summary>
/// Persisted to C:\ProgramData\DreamersRemote\topaz_config.json.
/// Phase 4 (P4-4): where Topaz Video AI's own (proprietary, non-PATH)
/// ffmpeg build lives on this machine, plus the model cache directory
/// its "tvai_up" filter needs via TVAI_MODEL_DIR/TVAI_MODEL_DATA_DIR
/// (see TopazJobRunner) -- confirmed required by testing the real CLI
/// by hand: without these set, "tvai_up" fails with "Model not found"
/// even for an already-downloaded model. Defaults match Topaz's own
/// installer convention; hand-editable if a workstation installs
/// elsewhere. Editable by hand; the agent only reads this, never writes
/// to it after the initial default file is created (same convention as
/// AllowedPathsConfig).
/// </summary>
public sealed class TopazConfig
{
    public string FfmpegPath { get; set; } = @"C:\Program Files\Topaz Labs LLC\Topaz Video AI\ffmpeg.exe";
    public string ModelDir { get; set; } = @"C:\ProgramData\Topaz Labs LLC\Topaz Video AI\models";
}
