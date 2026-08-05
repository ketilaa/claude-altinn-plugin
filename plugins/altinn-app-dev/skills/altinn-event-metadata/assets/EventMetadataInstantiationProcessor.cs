using System.Collections.Generic;
using System.Threading.Tasks;
using Altinn.App.Core.Features;
using Altinn.Platform.Storage.Interface.Models;

namespace Altinn.App.EventMetadata;

/// <summary>
/// Ensures configured EventMetadata values are stamped onto the instance as soon as it is created.
/// </summary>
public class EventMetadataInstantiationProcessor : IInstantiationProcessor
{
    private readonly EventMetadataSyncService _syncService;

    public EventMetadataInstantiationProcessor(EventMetadataSyncService syncService)
    {
        _syncService = syncService;
    }

    public async Task DataCreation(Instance instance, object data, Dictionary<string, string> prefill)
    {
        await _syncService.SyncAsync(instance, data);
    }
}
