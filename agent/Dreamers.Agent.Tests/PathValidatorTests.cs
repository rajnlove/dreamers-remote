using Dreamers.Agent.Core.Ffmpeg;
using Xunit;

namespace Dreamers.Agent.Tests;

public class PathValidatorTests
{
    private static readonly string[] Roots = { "\\\\192.29.11.92\\Projects" };

    [Fact]
    public void AcceptsExactRootAndSubpath()
    {
        Assert.True(PathValidator.IsUnderAllowedRoot("\\\\192.29.11.92\\Projects", Roots));
        Assert.True(PathValidator.IsUnderAllowedRoot("\\\\192.29.11.92\\Projects\\job1\\in.mov", Roots));
    }

    [Fact]
    public void IsCaseInsensitiveAndSlashTolerant()
    {
        Assert.True(PathValidator.IsUnderAllowedRoot("\\\\192.29.11.92\\PROJECTS\\x.mov", Roots));
        Assert.True(PathValidator.IsUnderAllowedRoot("//192.29.11.92/Projects/x.mov", Roots));
    }

    [Fact]
    public void RejectsASiblingPathThatMerelySharesAPrefix()
    {
        Assert.False(PathValidator.IsUnderAllowedRoot("\\\\192.29.11.92\\ProjectsOther\\x.mov", Roots));
    }

    [Fact]
    public void RejectsAnyPathContainingDotDot()
    {
        Assert.False(PathValidator.IsUnderAllowedRoot("\\\\192.29.11.92\\Projects\\..\\..\\Windows\\System32\\x.exe", Roots));
    }

    [Fact]
    public void RejectsEverythingWhenNoRootsAreConfigured()
    {
        Assert.False(PathValidator.IsUnderAllowedRoot("\\\\192.29.11.92\\Projects\\x.mov", Array.Empty<string>()));
    }
}
