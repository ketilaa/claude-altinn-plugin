using System;
using System.Threading.Tasks;
using Altinn.App.Core.Features;
using Altinn.Platform.Storage.Interface.Models;

namespace Altinn.App.CustomServices.EventMetadata;

/// <summary>
/// Re-resolves configured EventMetadata values every time the user saves form data, so templated values
/// depending on user input stay in sync with the current model.
/// </summary>
public class EventMetadataDataProcessor : IDataProcessor
{
    private readonly EventMetadataSyncService _syncService;

    public EventMetadataDataProcessor(EventMetadataSyncService syncService)
    {
        _syncService = syncService;
    }

    public Task ProcessDataRead(Instance instance, Guid? dataId, object data, string language)
    {
        return Task.CompletedTask;
    }

    public async Task ProcessDataWrite(Instance instance, Guid? dataId, object data, object previousData, string language)
    {
        await _syncService.SyncAsync(instance, data);
    }
}
