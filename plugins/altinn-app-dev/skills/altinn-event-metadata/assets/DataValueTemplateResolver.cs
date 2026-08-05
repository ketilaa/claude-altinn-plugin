using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Altinn.App.EventMetadata;

/// <summary>
/// Resolves "${model.some.path}" placeholders in a template string against the current form data model.
/// The path segments are matched case-insensitively against the model's JSON property names. A template
/// with no placeholders resolves to itself, so this same mechanism covers both fixed and dynamic values.
/// </summary>
public static class DataValueTemplateResolver
{
    private static readonly Regex PlaceholderPattern = new Regex(@"\$\{model\.([A-Za-z0-9_.]+)\}", RegexOptions.Compiled);

    public static string Resolve(string template, object model)
    {
        JsonNode modelNode = JsonSerializer.SerializeToNode(model);
        return PlaceholderPattern.Replace(template, match => ResolvePath(modelNode, match.Groups[1].Value) ?? string.Empty);
    }

    private static string ResolvePath(JsonNode node, string path)
    {
        foreach (string segment in path.Split('.'))
        {
            if (node is not JsonObject obj)
            {
                return null;
            }

            node = obj.FirstOrDefault(property => string.Equals(property.Key, segment, System.StringComparison.OrdinalIgnoreCase))
                .Value;
        }

        return node?.ToString();
    }
}
