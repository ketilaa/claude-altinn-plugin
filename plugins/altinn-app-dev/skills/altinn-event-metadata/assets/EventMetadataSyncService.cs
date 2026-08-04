using System.Collections.Generic;
using System.Threading.Tasks;
using Altinn.App.Core.Internal.Instances;
using Altinn.Platform.Storage.Interface.Models;
using Microsoft.Extensions.Configuration;

namespace Altinn.App.CustomServices.EventMetadata;

/// <summary>
/// Resolves the key/template pairs configured under the "EventMetadata" section of appsettings.json against
/// the current form data model, and stamps the result onto Instance.DataValues so it is available to whatever
/// consumes the instance after receiving an Altinn Event for it.
/// </summary>
public class EventMetadataSyncService
{
    private const string ConfigSectionName = "EventMetadata";

    private readonly IConfiguration _configuration;
    private readonly IInstanceClient _instanceClient;

    public EventMetadataSyncService(IConfiguration configuration, IInstanceClient instanceClient)
    {
        _configuration = configuration;
        _instanceClient = instanceClient;
    }

    public async Task SyncAsync(Instance instance, object model)
    {
        Dictionary<string, string> templates = _configuration
            .GetSection(ConfigSectionName)
            .Get<Dictionary<string, string>>();
        if (templates == null || templates.Count == 0)
        {
            return;
        }

        Dictionary<string, string> currentValues = instance.DataValues ?? new Dictionary<string, string>();
        Dictionary<string, string> changedValues = new Dictionary<string, string>();
        foreach (KeyValuePair<string, string> template in templates)
        {
            string resolvedValue = DataValueTemplateResolver.Resolve(template.Value, model);
            currentValues.TryGetValue(template.Key, out string currentValue);
            if (currentValue != resolvedValue)
            {
                changedValues[template.Key] = resolvedValue;
            }
        }

        if (changedValues.Count > 0)
        {
            await _instanceClient.UpdateDataValues(instance, changedValues);
        }
    }
}
