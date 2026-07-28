# Multi-Platform Business Directory Scraper & Local Citation Audit Engine

> A scalable, enterprise-grade NestJS service that performs **real-time local citation audits** across multiple business directories, search engines, and social platforms. The system is inspired by core Yext functionality, enabling automated NAP (Name, Address, Phone) verification, consistency auditing, and database synchronization.

---

## Overview

This project scrapes business listings from multiple online directories, validates the consistency of business information against user-provided data, and stores audit results for future analysis.

The engine is designed with scalability, fault tolerance, and concurrency control in mind, making it suitable for processing large batches of business citation audits while minimizing resource consumption and avoiding rate limits.

---

# Features

- **20+ Directory Integrations**
  - Yelp
  - Hotfrog
  - MerchantCircle
  - GoLocal247
  - Kompass
  - EnrollBusiness
  - Google Maps 
  - Facebook 
  - Instagram 
  - Apple Maps 
  - OpenStreetMap 
  - N49 
  - Opendi
  - MapQuest 

- **Concurrent Worker Pool**
  - Configurable concurrency limit
  - Prevents memory spikes
  - Reduces risk of IP blocking
  - Efficient resource utilization

- **NAP Verification Engine**
  - Name matching
  - Address matching
  - Phone normalization
  - Confidence scoring
  - Verification status generation

- **Database Synchronization**
  - Automatic insert/update
  - Duplicate prevention
  - State tracking
  - Audit history maintenance

- **Fault Tolerant Execution**
  - Individual scraper failures do not interrupt batch execution
  - Graceful error handling
  - Safe wrapper around every scraper

- **Real-Time Progress Streaming**
  - Supports callback functions
  - Compatible with WebSockets
  - Compatible with Server-Sent Events (SSE)

---

# Technology Stack

- NestJS
- TypeScript
- TypeORM
- PostgreSQL
- Puppeteer / Playwright *(depending on scraper implementation)*
- Axios
- Cheerio
- Worker Pool Pattern

---

# System Architecture

```
                        Incoming Request
                               │
                               ▼
                   Create Scraper Task Factory
                               │
                               ▼
                  Concurrent Worker Pool (Limit = 3)
                               │
      ┌────────────────────────┼────────────────────────┐
      ▼                        ▼                        ▼
   Worker 1                 Worker 2                Worker 3
      │                        │                        │
      ├── Safe Scrape          ├── Safe Scrape         ├── Safe Scrape
      ├── NAP Audit            ├── NAP Audit           ├── NAP Audit
      ├── Database Sync        ├── Database Sync       ├── Database Sync
      └── Stream Callback      └── Stream Callback     └── Stream Callback
```

---

# Workflow

1. Receive business details.
2. Create scraping tasks for enabled platforms.
3. Execute tasks using a configurable worker pool.
4. Collect scraped business information.
5. Compare scraped data with expected NAP values.
6. Generate audit results.
7. Update or insert records into the database.
8. Return structured audit results.
9. Optionally stream each completed result.

---

# Concurrency Control

Instead of executing every scraper using `Promise.all()`, the service processes tasks through a configurable worker pool.

```typescript
const CONCURRENCY_LIMIT = 3;

let currentIndex = 0;

const worker = async () => {
  while (currentIndex < taskFactories.length) {
    const index = currentIndex++;
    const task = taskFactories[index];
    await task();
  }
};

const workers = Array.from(
  { length: CONCURRENCY_LIMIT },
  () => worker()
);

await Promise.all(workers);
```

### Benefits

- Prevents excessive memory usage
- Avoids request bursts
- Minimizes IP bans
- Better CPU utilization
- Scales efficiently

---

# NAP Verification Engine

The audit engine validates three primary business attributes.

## 1. Name Matching

- Direct substring comparison
- Token overlap comparison
- Minimum **40% token match**

---

## 2. Address Matching

- Substring comparison
- Token overlap analysis
- Minimum **40% token match**

---

## 3. Phone Matching

Phone numbers are normalized before comparison.

Example:

```
+1 (555) 123-4567
```

↓

```
5551234567
```

Comparison is then performed using strict equality.

---

# Verification Rules

A listing is considered **Verified** if **at least two of the following match**:

- Name
- Address
- Phone

Otherwise it is marked as **Mismatch**.

---

# Confidence Score

```
Score = round((Matched Criteria / 3) × 100)
```

| Matched Fields | Match Count | Status | Score |
|---------------|------------|--------|------|
| None | 0 | Mismatch | 0% |
| Any 1 | 1 | Mismatch | 33% |
| Any 2 | 2 | Verified | 67% |
| All 3 | 3 | Verified | 100% |

---

# Supported Directory Integrations

| Directory | Status | Inputs |
|-----------|--------|--------|
| Yelp | Active | Name, Location |
| Hotfrog | Active | Name, Location |
| MerchantCircle | Active | Name, Location |
| GoLocal247 | Active | Name, Location |
| Kompass | Active | Name |
| EnrollBusiness | Active | Name, Category, Location |
| Google Maps | Disabled | Name, Location |
| Facebook | Disabled | Name |
| Instagram | Disabled | Name |
| Apple Maps | Disabled | Name, Location |
| OpenStreetMap | Disabled | Name, Location |
| MapQuest | Disabled | Name, Location |
| N49 | Disabled | Name, Location |
| Opendi | Disabled | Name, Location |

---

# Database Synchronization

The project uses **TypeORM** to maintain citation records.

## Stored Entity

```typescript
{
  name,
  address,
  phone,
  locationLink,
  source,
  status
}
```

## Synchronization Logic

For every scraped result:

- Search using `locationLink`
- Insert new record if none exists
- Update existing record when data changes
- Skip update if no changes are detected

If database synchronization fails, the scraper still returns the collected data without interrupting the audit process.

---

# Example Response

## Verified Listing

```json
{
  "scraped": {
    "name": "Bright Dental Clinic",
    "phone": "5551234567",
    "address": "123 Main St, New York, NY"
  },
  "meta": {
    "source": "Yelp",
    "locationLink": "https://www.yelp.com/biz/bright-dental-clinic",
    "timestamp": "2026-07-28T10:52:34.000Z"
  },
  "audit": {
    "status": "Verified",
    "score": 100,
    "matched": {
      "name": true,
      "phone": true,
      "address": true
    }
  }
}
```

---

## Mismatch Listing

```json
{
  "scraped": {
    "name": "",
    "phone": "",
    "address": ""
  },
  "meta": {
    "source": "MerchantCircle",
    "locationLink": ""
  },
  "audit": {
    "status": "Mismatch",
    "score": 0,
    "matched": {
      "name": false,
      "phone": false,
      "address": false
    }
  }
}
```

---

# Public API

## scrapeAllPlatforms()

Executes the complete multi-platform citation audit.

```typescript
scrapeAllPlatforms(
    name,
    location,
    phone,
    locationLink,
    onResultReady?
)
```

### Parameters

| Parameter | Type | Required | Description |
|------------|------|----------|-------------|
| name | string | Yes | Business name |
| location | string | Yes | City, State, or Address |
| phone | string | Yes | Expected business phone |
| locationLink | string | Yes | Known citation URL |
| onResultReady | function | No | Callback fired after each completed scraper |

---

## checkNAPMatch()

Evaluates the consistency between scraped data and expected business details.

```typescript
checkNAPMatch(
    scraped,
    inputName,
    inputPhone,
    inputLocation
)
```

### Returns

- Verification Status
- Confidence Score
- Individual Match Flags
- Matched Values

---

# Error Handling

Every scraper executes inside a protected wrapper.

Benefits include:

- Batch execution continues even if one scraper fails.
- Errors are logged without terminating the process.
- Partial results are always returned.

---

# Scalability

The architecture is designed to support:

- Adding new directory providers with minimal effort
- Horizontal scaling
- Queue-based execution
- WebSocket progress updates
- Scheduled citation audits
- Large-scale enterprise processing

---

# Future Enhancements

- Google Maps integration
- Facebook integration
- Instagram integration
- Apple Maps integration
- OpenStreetMap integration
- Queue support using BullMQ
- Redis caching
- Proxy rotation
- CAPTCHA solving
- Distributed worker architecture
- Dashboard for citation analytics
- Historical audit reports

---

# Project Highlights

- Enterprise-grade NestJS architecture
- Modular scraper design
- Concurrent worker pool
- Fault-tolerant execution
- Real-time progress streaming
- Intelligent NAP verification engine
- Automatic database synchronization
- Easily extensible for new directory providers

---


### Example Test cases : 


```
Airdrie Choice Dental
2100 Market St, Airdrie, AB T4A 0R8 
5877759911
https://www.airdriechoicedental.com/

---


Swanavon Dental Clinic
10104 97 Ave, Grande Prairie, AB T8V 7X6 
7808311150
https://www.swanavondental.ca/
---

Darji Clinic 20000
767 Peachtree Pkwy Unit 4, Cumming, GA 30041, USA
(678) 208-3460
https://www.darjiclinic.com/

---

Wright Smiles Pediatric Dentistry
50 Remick Blvd, Springboro, OH
(937) 885-2222
https://www.wrightsmilespediatricdentistry.com/

```


