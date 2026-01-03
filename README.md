# LinkedIn Job Suitability Analyzer

A tool for scraping LinkedIn job postings and analyzing their suitability against your resume and your preferences using AI, so that you don't need to filter through job postings. It helps you find suitable jobs with almost zero effort required from you. It helps you dedicate your precious time elsewhere. 

## Features

- **LinkedIn Job Scraper**: Automated scraping of LinkedIn job postings with pagination support
- **AI-Powered Job Analysis**: Uses Google Gemini AI to match jobs against your resume
- **Smart Caching**: Avoids re-scraping or re-analyzing jobs already processed
- **Detailed Reports**: Generates summary reports and top matches for easy review

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v22 or higher recommended)
- **npm** (comes with Node.js)
- **Google Chrome** browser
- **Google AI API access** (choose one):
  - **Gemini API**: Free API key from [Google AI Studio](https://aistudio.google.com/app/apikey) (recommended for getting started)
  - **Vertex AI**: Google Cloud Platform account with Vertex AI access

## Setup

1. Install dependencies:
```bash
npm install
```

2. Install Playwright browsers (if not already installed):
```bash
npx playwright install chromium
```

3. Set up Google AI credentials (for job suitability analysis):
   - Copy `.env.example` to `.env`
   - Choose one of two options:

     **Option A: Gemini API (Recommended for simplicity)**
     - Get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
     - Set `GOOGLE_API_KEY=your-api-key` in `.env`

     **Option B: Vertex AI (For production/enterprise use)**
     - Configure your Google Cloud project settings
     - Set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` in `.env`
     - Ensure you have access to Vertex AI
     - Set up service account credentials

4. Add your resume:
   - Place your resume content in `resume.md` in the root directory

## Usage

### Step 1: Configure Search Filters

**IMPORTANT**: Before scraping, customize the search URL by setting the `LINKEDIN_JOBS_URL` environment variable in your .env file:

```bash
LINKEDIN_JOBS_URL=https://www.linkedin.com/jobs/search/?f_E=4%2C5%2C6&geoId=103644278
```

To customize your search:
1. Go to LinkedIn Jobs and apply your desired filters (experience level, location, job type, etc.)
2. Copy the URL from your browser
3. Update the `LINKEDIN_JOBS_URL` value in your `.env` file

This ensures you only scrape jobs that match your preferences, saving time and API costs.

### Step 2: Start Chrome in Debug Mode

Run the provided batch file to start Chrome with remote debugging:
```bash
start-chrome-debug.bat
```

Or manually run:
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

### Step 3: Scrape LinkedIn Jobs

**Important**: Make sure you're logged into LinkedIn in the Chrome browser before running the scraper.

```bash
npm run scrape
```

This will:
- Connect to your existing Chrome browser session
- Navigate to the specified LinkedIn jobs search URL
- Scroll through job listings and paginate through all results
- Extract full details from each job posting
- Save each job as a separate `.txt` file in the `job-postings/` folder
- Skip jobs that were already scraped previously
- Display progress and summary statistics

### Step 4: Analyze Job Suitability

After step 3, run

```bash
npm run analyze
```

This will:
- Load your resume from `resume.md`
- Analyze each job posting against your resume using Google Gemini AI
- Generate a suitability score (0-10) and status for each job
- Identify key strengths and gaps for each position
- Save results to `job-suitability-results.json`
- Generate detailed reports in `job-suitability-summary.txt` and `job-suitability-top-matches.txt`
- Skip jobs that were already analyzed (incremental processing)

## Output Files

### From Scraper
- `job-postings/*.txt`: Individual job postings with company, location, and full description

### From Analyzer
- `job-suitability/results.json`: Complete analysis results sorted by match score
- `job-suitability/summary.txt`: Detailed report with suitable and maybe-suitable jobs
- `job-suitability/top-matches.txt`: Quick reference guide to top 20 matches

## Job Suitability Criteria

The analyzer evaluates jobs based on:
- Required skills and experience alignment
- Years of experience requirements (with +3 years tolerance)
- Technical skills match
- Programming knowledge requirements and flexibility
- Leadership/management experience
- Certifications and education requirements
- Specific language requirements (Japanese, Chinese, etc.)
- Role preferences (filters out sales/marketing, prefers leadership positions)

## Customization

### Modify Search Filters

You can customize your LinkedIn job search filters by setting the `LINKEDIN_JOBS_URL` environment variable in your .env file:

```bash
LINKEDIN_JOBS_URL=https://www.linkedin.com/jobs/search/?f_E=4%2C5%2C6&geoId=103644278
```

To customize your search:
1. Go to LinkedIn Jobs and apply your desired filters (experience level, location, job type, etc.)
2. Copy the URL from your browser
3. Update the `LINKEDIN_JOBS_URL` value in your `.env` file

This ensures you only scrape jobs that match your preferences, saving time and API costs.

### Adjust Analysis Preferences

The AI prompt that evaluates job suitability can be customized to match your specific preferences and priorities. Edit the `JOB_ANALYSIS_PROMPT` constant in job-suitability.ts:12.

**Key sections to customize:**

1. **Candidate Preferences** (around line 29):
```typescript
Candidate's preferences:
- Does not want sales or marketing roles
- Prefers roles with some mid to senior leadership opportunities
- Ready to relocate globally or remotely for the right opportunity.
```

2. **Evaluation Criteria**: Update the scoring logic and requirements to emphasize:
   - Specific technical skills or technologies you prioritize
   - Deal-breakers (e.g., required languages, mandatory certifications)
   - Years of experience tolerance (+/- range that works for you)
   - Industry or domain preferences
   - Remote/hybrid/on-site requirements
   - Company stage (startup, scale-up, enterprise)

3. **Scoring Thresholds**: Adjust what qualifies as "suitable" vs "maybe suitable" vs "not suitable"

**Example customizations:**
- Change preference from "leadership opportunities" to "individual contributor track"
- Add "Must support visa sponsorship" as a requirement
- Emphasize specific tech stack (e.g., "Strongly prefer roles using React, TypeScript, and AWS")
- Include work-life balance factors
- Filter by company size or funding stage
- Prioritize fully remote opportunities

## Important Notes

⚠️ **LinkedIn Authentication**: The scraper requires you to be logged into LinkedIn in the Chrome browser. The script connects to your existing browser session to maintain authentication.

⚠️ **Rate Limiting**: Be mindful of LinkedIn's rate limits. The scraper includes random delays (1.5-2.5 seconds) between job clicks to mimic human behavior.

⚠️ **Terms of Service**: Ensure your use complies with LinkedIn's Terms of Service and robots.txt.

⚠️ **API Costs**: The job analyzer uses Google Gemini AI. Monitor your API usage and costs. The script uses caching to minimize repeated API calls.

⚠️ **Incremental Processing**: Both tools support incremental processing - they remember what's already been processed and skip duplicates, allowing you to run them multiple times safely.

⚠️ **Educational purpose**: This project is for education purpose only. It shows how to use playwright and genai to automate manual time taking work.
