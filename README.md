# SSG Torn Faction Dashboard

## Prerequisites

### MongoDB
This project requires a local MongoDB instance running. 

#### Setup
1. Install MongoDB Community Edition
2. Ensure MongoDB is running on localhost:27017
3. Create a database named `stock_observation_test` for running tests

#### Test Database Configuration
You can override the test database URI by setting the `TEST_MONGO_URI` environment variable.

### Running Tests
```bash
npm test
```

## Development Notes
- Stock observation tests require a running MongoDB instance
- Ensure MongoDB is configured and running before executing tests

### Stable Item ID Generation
The stock observation system now uses a stable ID generation mechanism:
- If no ID is provided, a stable ID is generated from the item name
- Conversion process:
  1. Convert name to lowercase
  2. Remove non-alphanumeric characters
  3. Replace removed characters with underscores
- Example: 
  - "Plushie: Alien" → "plushie_alien"
  - "Flower: Rose" → "flower_rose"
