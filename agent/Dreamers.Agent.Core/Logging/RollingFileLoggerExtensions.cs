using Microsoft.Extensions.Logging;

namespace Dreamers.Agent.Core.Logging;

public static class RollingFileLoggerExtensions
{
    public static ILoggingBuilder AddRollingFile(this ILoggingBuilder builder, Action<RollingFileLoggerOptions> configure)
    {
        var options = new RollingFileLoggerOptions();
        configure(options);
        builder.AddProvider(new RollingFileLoggerProvider(options));
        return builder;
    }
}
