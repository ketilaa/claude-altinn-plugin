---
name: altinn-map-polygon-upload
description: Complete reference for displaying WKT polygons on an Altinn Map component via file upload. Use this whenever working with FileUpload + Map component combinations in Altinn Studio apps, especially when the polygon comes from an uploaded file (WKT/GeoJSON) rather than drawn by the user, when ProcessDataWrite needs to populate a geometry list from an attachment, or when debugging map binding errors ("geometries must be array", "Invalid location string", "geometryIsEditable cannot be used without toolbar").
---

# Map polygon via file upload in Altinn

## The problem this solves

A FileUpload field uploads a file as an attachment — but an upload alone doesn't trigger `ProcessDataWrite`
on the data model. To display a polygon from an uploaded WKT file on a Map component you need:

1. A trigger field in the data model that FileUpload writes to on upload
2. A list type in the data model with the structure the Map component expects
3. An `IDataProcessor.ProcessDataWrite` that reads the file and populates the list
4. Correct Map component configuration using object-format bindings

---

## Data model

### Trigger field

FileUpload with `simpleBinding` writes the attachment GUID to this field on upload. That triggers an
auto-save of the model, which calls `ProcessDataWrite`.

```csharp
[XmlElement("WktTrigger", Order = N)]
[JsonProperty("WktTrigger")]
[JsonPropertyName("WktTrigger")]
public string? WktTrigger { get; set; }
```

### Geometry list

All list classes in Altinn **must** have `altinnRowId`. Without it the frontend can't identify the
elements and the polygon won't render.

```csharp
public class WktGeometry
{
    [XmlAttribute("altinnRowId")]
    [JsonPropertyName("altinnRowId")]
    [System.Text.Json.Serialization.JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    [Newtonsoft.Json.JsonIgnore]
    public Guid AltinnRowId { get; set; }

    public bool ShouldSerializeAltinnRowId() => AltinnRowId != default;

    [XmlElement("label", Order = 1)]
    [JsonProperty("label")]
    [JsonPropertyName("label")]
    public string? Label { get; set; }

    [XmlElement("data", Order = 2)]
    [JsonProperty("data")]
    [JsonPropertyName("data")]
    public string? Data { get; set; }
}
```

And in the main model:

```csharp
[XmlElement("Geometries", Order = N+1)]
[JsonProperty("Geometries")]
[JsonPropertyName("Geometries")]
public List<WktGeometry>? Geometries { get; set; }
```

Remember `using System;` (for `Guid`) and `using System.Collections.Generic;`.

### XSD

```xml
<xs:element minOccurs="0" name="WktTrigger" type="xs:string" />
<xs:element name="Geometries" minOccurs="0" maxOccurs="unbounded">
  <xs:complexType>
    <xs:sequence>
      <xs:element minOccurs="0" name="label" type="xs:string" />
      <xs:element minOccurs="0" name="data" type="xs:string" />
    </xs:sequence>
    <xs:attribute name="altinnRowId" type="xs:string" />
  </xs:complexType>
</xs:element>
```

### JSON Schema

```json
"WktTrigger": { "type": "string" },
"Geometries": {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "altinnRowId": { "type": "string" },
      "label": { "type": "string" },
      "data": { "type": "string" }
    }
  }
}
```

---

## IDataProcessor

Use `ProcessDataWrite` (not `ProcessDataRead`) — that persists the WKT content to the model's XML
storage. `ProcessDataRead` is transient and isn't saved.

```csharp
#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Altinn.App.Core.Features;
using Altinn.App.Core.Internal.Data;
using Altinn.App.Models.YourModel;
using Altinn.Platform.Storage.Interface.Models;

namespace Altinn.App.Logic.DataProcessing
{
    public class WktDataProcessor : IDataProcessor
    {
        private readonly IDataClient _dataClient;

        public WktDataProcessor(IDataClient dataClient)
        {
            _dataClient = dataClient;
        }

        public Task ProcessDataRead(Instance instance, Guid? dataId, object data, string? language)
            => Task.CompletedTask;

        public async Task ProcessDataWrite(Instance instance, Guid? dataId, object data, object? previousData, string? language)
        {
            if (data is not YourModel formData)
                return;

            var wktElement = instance.Data?.FirstOrDefault(d => d.DataType == "area-wkt");
            if (wktElement is null)
            {
                formData.Geometries = null;
                return;
            }

            var instanceGuid = Guid.Parse(instance.Id.Split('/')[1]);
            Stream stream = await _dataClient.GetBinaryData(
                int.Parse(instance.InstanceOwner.PartyId),
                instanceGuid,
                Guid.Parse(wktElement.Id)
            );

            using var reader = new StreamReader(stream);
            var wkt = (await reader.ReadToEndAsync()).Trim();
            formData.Geometries = new List<WktGeometry> { new WktGeometry { Data = wkt } };
        }
    }
}
```

Register in `Program.cs`:

```csharp
services.AddTransient<IDataProcessor, WktDataProcessor>();
```

---

## Layout — FileUpload

`simpleBinding` with object format. Without this the GUID isn't written to the model and
`ProcessDataWrite` never fires:

```json
{
  "id": "area-wkt",
  "type": "FileUpload",
  "dataTypeId": "area-wkt",
  "displayMode": "list",
  "minNumberOfAttachments": 0,
  "maxNumberOfAttachments": 1,
  "maxFileSizeInMB": 5,
  "dataModelBindings": {
    "simpleBinding": {
      "field": "WktTrigger",
      "dataType": "model"
    }
  }
}
```

**Important:** the component `id` **must** match the datatype ID in `applicationmetadata.json`. The
Altinn frontend uses the component `id` as the URL segment for uploads, not the `dataTypeId` field.

---

## Layout — Map

Use **object format** for bindings (`{ "field": "...", "dataType": "model" }`), not plain strings.
String format has different validation rules and can produce errors.

```json
{
  "id": "map-area",
  "type": "Map",
  "dataModelBindings": {
    "geometries": {
      "field": "Geometries",
      "dataType": "model"
    },
    "geometryData": {
      "field": "Geometries.data",
      "dataType": "model"
    }
  },
  "geometryType": "WKT",
  "centerLocation": { "latitude": 65.0, "longitude": 15.0 },
  "zoom": 4
}
```

**Don't use** the `geometryIsEditable` binding without `toolbar` — it produces a configuration error.

---

## applicationmetadata.json

For WKT files: don't restrict `allowedContentTypes` to `application/octet-stream` (browsers never
report that type). Use an empty list (accepts anything) or include `text/plain`:

```json
{
  "id": "area-wkt",
  "allowedContentTypes": [],
  "taskId": "Task_1",
  "maxCount": 1,
  "minCount": 0,
  "enablePdfCreation": false
}
```

---

## Common errors and fixes

| Error | Cause | Fix |
|------|-------|-----|
| `400` on upload | Component `id` ≠ datatype ID in metadata | Set component `id` = datatype ID |
| `Invalid location string: POLYGON ((...))` | Map `simpleBinding` only supports `"lat,lon"` — not WKT | Switch to a `geometries` binding + `geometryType: "WKT"` |
| `geometries must be array` | Model field is `string`, not `List<T>` | Create a list class with `altinnRowId` |
| `property 'label' not found` | `geometryLabel` defaults to `"label"` and the field doesn't exist | Add a `label` field to the list class |
| `geometryData must start with geometries field` | String binding `"data"` is missing the prefix | Use `"Geometries.data"` (full path) |
| `geometryIsEditable cannot be used without toolbar` | Binding without toolbar config | Remove the `geometryIsEditable` binding |
| Polygon doesn't render (no error) | List class is missing `altinnRowId` | Add an `AltinnRowId Guid` with the correct attributes |
| Map doesn't update after upload | FileUpload is missing `simpleBinding` to the trigger field | Add `dataModelBindings.simpleBinding` to the FileUpload |

---

## Coordinate format

The WKT standard uses **lon/lat** order (X/Y). Altinn's Map component (OpenLayers) interprets WKT in
standard order, so coordinates such as `9.32 59.28` (lon lat) place correctly. No conversion needed.
