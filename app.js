document.addEventListener('DOMContentLoaded', (event) => {
mapboxgl.accessToken = 'pk.eyJ1Ijoic3BlY3RhdG9yMTIxIiwiYSI6ImNsanh0OHZ2YjA3NTAzZ3BhbW1ueHpsMTUifQ.UT_rGnGgU7N1UsVc8Tfypw'; 
var map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/dark-v10',
  center: [-0.0165, 51.5430],
  zoom: 14
});

var BluetoothDataSources = [];
var ConnectSourceButton = document.querySelector('#connect_button');
var points = [];
let linesWithPoints = {}; // To keep track of lines with points


function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return function() {
        const context = this;
        const args = arguments;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function() {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}

let isThrottled = false;

function logData(latitude, longitude, roadsGeoJSON) {
  if (isThrottled) return;

  isThrottled = true;

  console.log("GPS Point:", latitude, longitude);
  console.log("GeoJSON Data:", roadsGeoJSON);

  setTimeout(() => {
    isThrottled = false;
  }, 2000); // Throttle for 2 seconds
}

const throttledUpdateMap = throttle(updateMap, 10000); // Update map at most every 2 seconds

registerBluetoothDataSource(BluetoothDataSources, "90D3D000-C950-4DD6-9410-2B7AEB1DD7D8", "d3683933-d930-4a99-9fed-4b3d44d9e4f0", blehandle_sint16, '', '');

let roadsGeoJSON;
let filteredRoads;

function convertMultiPolygonToLineString(geoJSON) {
    let lineFeatures = [];

    geoJSON.features.forEach(feature => {
        if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates.forEach(polygon => {
                polygon.forEach(ring => {
                    let lineFeature = {
                        type: 'Feature',
                        properties: feature.properties,
                        geometry: {
                            type: 'LineString',
                            coordinates: ring
                        }
                    };
                    lineFeatures.push(lineFeature);
                });
            });
        } else if (feature.geometry.type === 'LineString') {
            lineFeatures.push(feature);
        }
    });

    return {
        type: 'FeatureCollection',
        features: lineFeatures
    };
}

fetch('elizabeth park.geojson')
    .then(response => response.json())
    .then(data => {
        roadsGeoJSON = convertMultiPolygonToLineString(data);
        filteredRoads = {
            type: 'FeatureCollection',
            features: roadsGeoJSON.features.filter(feature => 
                feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')
        };
    })
    .catch(error => {
        console.error("Error fetching the GeoJSON data:", error);
    });
    
ConnectSourceButton.addEventListener('click', function() {
    console.log('Requesting Bluetooth Service...');
    navigator.bluetooth.requestDevice({
        filters: [{services: ["90D3D000-C950-4DD6-9410-2B7AEB1DD7D8".toLowerCase()]}],
        optionalServices: ['battery_service', 'generic_access', 'environmental_sensing', "90D3D000-C950-4DD6-9410-2B7AEB1DD7D8".toLowerCase()]
    })
    .then(device => {
        BluetoothDataSources.forEach(source => {
            connectBlueToothCharacteristic(device, source.BluetoothServiceUUID.toLowerCase(), source.BluetoothCharacteristicUUID.toLowerCase(), source.ValueHandler, source.TargetSelector, source.DataLog);
        });
    })
    .catch(error => {
        console.log('error:' + error);
    });
});

function fetchNoiseData() {
    db.collection("noiseData").get().then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            points.push(data);
        });
        throttledUpdateMap(); // Update the map after fetching all data
    });
}

map.on('load', function() {
    fetchNoiseData();
    map.addSource('noiseData', {
        'type': 'geojson',
        'data': {
            'type': 'FeatureCollection',
            'features': []
        }
    });

    map.addLayer({
        'id': 'noiseLines',
        'type': 'line',
        'source': 'noiseData',
        'layout': {},
        'paint': {
            'line-color': ['get', 'color'],
            'line-width': 5
        }
    });
    map.moveLayer('noiseLines');  // Move the 'noiseLines' layer to the top

    throttledUpdateMap(); // Update the map after fetching all data and ensuring the map is loaded
});

function registerBluetoothDataSource(BluetoothDataSourcesArray, BluetoothServiceUUID, BluetoothCharacteristicUUID, ValueHandler, TargetSelector, DataLog) {
    BluetoothDataSourcesArray.push({
        BluetoothServiceUUID: BluetoothServiceUUID,
        BluetoothCharacteristicUUID: BluetoothCharacteristicUUID,
        ValueHandler: ValueHandler,
        TargetSelector: TargetSelector,
        DataLog: DataLog
    });
}

function connectBlueToothCharacteristic(BluetoothDevice, BluetoothServiceUUID, BluetoothCharacteristicUUID, ValueHandler, TargetSelector, DataLog) {
    console.log('Connecting bluetooth data source: ' + BluetoothServiceUUID + ', ' + BluetoothCharacteristicUUID);
    BluetoothDevice.gatt.connect()
        .then(server => server.getPrimaryService(BluetoothServiceUUID))
        .then(service => service.getCharacteristic(BluetoothCharacteristicUUID))
        .then(characteristic => characteristic.startNotifications())
        .then(characteristic => characteristic.addEventListener('characteristicvaluechanged', function(event) { ValueHandler(event, TargetSelector, DataLog); }));
}


function blehandle_sint16(event, TargetSelector, DataLog) {
    const dbValue = event.target.value.getInt16(0, false) / 100;
    console.log("Noise Level:", dbValue);  // Log the noise level

    navigator.geolocation.getCurrentPosition(function(position) {
        var latitude = position.coords.latitude;
        var longitude = position.coords.longitude;

        // Snap the GPS point to the nearest road
        let gpsPoint = turf.point([longitude, latitude]);
        let snappedPoint = turf.nearestPointOnLine(roadsGeoJSON, gpsPoint);
        let lineKey = JSON.stringify(snappedPoint.geometry.coordinates);
        linesWithPoints[lineKey] = true;

        // Check the distance between the GPS point and the snapped point
        let distance = turf.distance(gpsPoint, snappedPoint);
        const maxDistance = 0.1; // Maximum distance in kilometers for snapping
        if (distance > maxDistance) {
            console.warn("GPS point is too far from the nearest road. Ignoring...");
            return;
        }

        latitude = snappedPoint.geometry.coordinates[1];
        longitude = snappedPoint.geometry.coordinates[0];

        logData(latitude, longitude, roadsGeoJSON); // Call the throttled logging function

        // Check if latitude and longitude are valid numbers
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            console.error("Invalid GPS coordinates:", latitude, longitude);
            return;
        }

        points.push({ latitude: latitude, longitude: longitude, noiseLevel: dbValue });
        throttledUpdateMap();

        // Store data in Firestore
        const noiseData = {
            latitude: latitude,
            longitude: longitude,
            noiseLevel: dbValue,
            timestamp: firebase.firestore.FieldValue.serverTimestamp() // adds a server timestamp
        };

        db.collection("noiseData").add(noiseData)
            .then(docRef => {
                console.log("Document written with ID: ", docRef.id);
            })
            .catch(error => {
                console.error("Error adding document: ", error);
            });
    });
}


function updateMap() {
    if (!map.loaded()) {
      console.warn("Map is not fully loaded yet.");
      return;
    }

    let linesWithPoints = {}; // To keep track of lines with points

    points.forEach(function(point, index) {
        if (index === 0) return;
        var color = getColorForNoiseLevel(point.noiseLevel);

        // Log GPS point
        console.log("GPS Point:", point.latitude, point.longitude);

        // Validate GPS point
        if (typeof point.latitude !== 'number' || typeof point.longitude !== 'number') {
            console.error("Invalid GPS coordinates:", point.latitude, point.longitude);
            return;
        }

        // Log and validate GeoJSON data
        console.log("GeoJSON Data:", roadsGeoJSON);
        if (!roadsGeoJSON || !Array.isArray(roadsGeoJSON.features)) {
            console.error("Invalid GeoJSON data:", roadsGeoJSON);
            return;
        }

        // Check if the GeoJSON data contains only lines
        if (roadsGeoJSON.features.some(feature => feature.geometry.type !== 'LineString')) {
            console.error("GeoJSON data contains non-line features.");
            return;
        }

        // Find the closest line to the GPS point
        let gpsPoint = turf.point([point.longitude, point.latitude]);
        let closestLine = null;
        let minDistance = Infinity;

        roadsGeoJSON.features.forEach(feature => {
            let distance = turf.pointToLineDistance(gpsPoint, feature);
            if (distance < minDistance) {
                minDistance = distance;
                closestLine = feature;
            }
        });

        // Update the color of the closest line
        if (closestLine) {
            let lineKey = JSON.stringify(closestLine.geometry.coordinates);
            linesWithPoints[lineKey] = color;
        }
    });

    roadsGeoJSON.features.forEach(feature => {
        let lineKey = JSON.stringify(feature.geometry.coordinates);
        if (linesWithPoints[lineKey]) {
            feature.properties.color = linesWithPoints[lineKey];
        } else {
            feature.properties.color = '#454545';
        }
    });

    map.getSource('noiseData').setData(roadsGeoJSON);

    // Adjust the opacity of the lines to blend them with the map
    map.setPaintProperty('noiseLines', 'line-opacity', 0.4);

    const noiseDataSource = map.getSource('noiseData');
    if (noiseDataSource) {
        noiseDataSource.setData(roadsGeoJSON);
    } else {
        console.error("'noiseData' source has not been added to the map yet.");
    }
}


function getColorForNoiseLevel(noiseLevel) {
    if (noiseLevel > 80) return 'red';
    if (noiseLevel > 60) return 'pink';
    if (noiseLevel > 40) return 'orange';
    if (noiseLevel > 20) return 'yellow';
    if (noiseLevel > 0) return 'white';
    return '#454545';
}

});
