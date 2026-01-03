import * as fs from "node:fs"
import * as path from "node:path"
import { GoogleGenAI } from "@google/genai"
import * as dotenv from "dotenv"

dotenv.config()

// Model configuration - can be overridden via GEMINI_MODEL env variable
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview"

// Job analysis prompt - edit this to customize the analysis criteria
const JOB_ANALYSIS_PROMPT = `You are an expert job matcher and career advisor. Analyze job postings against the candidate resume to determine suitability.

Analyze the match between the candidate and each job posting. Consider:
1. Required skills and experience match
2. Years of experience requirements (+3 years tolerance)
3. Technical skills alignment
4. If programming knowledge is required, check whether job posting is flexible or not.
5. Leadership/management experience
6. Specific certifications or education needed
7. Specific spoken languages requirement (Japanese, Chinese, etc.)

Provide a detailed analysis with:
- suitability_status: "suitable" (strong match), "maybe_suitable" (partial match), or "not_suitable" (poor match)
- match_score: numerical score from 0-10
- key_gaps: array of 0-5 specific gaps or missing requirements
- reasoning: 2-3 sentence explanation of the overall assessment

Candidate's preferences:
- Does not want sales or marketing roles
- Prefers roles with some mid to senior leadership opportunities such as Director, Head, VP, AVP or other senior positions. Not interested in entry-level software engineer roles.
- Ready to relocate globally or remotely for the right opportunity.`

// Define the structured output schema for job suitability analysis
interface JobSuitabilityResult {
	suitability_status: "suitable" | "not_suitable" | "maybe_suitable"
	match_score: number // 0-10
	key_strengths?: string[]
	key_gaps?: string[]
	reasoning?: string
}

interface AnalysisRecord {
	jobFile: string
	jobId: string
	linkedinUrl: string
	analyzedAt: string
	result: JobSuitabilityResult
}

interface AnalysisCache {
	[jobFileName: string]: AnalysisRecord
}

// Initialize AI client - supports both Vertex AI and Gemini API
// If GOOGLE_API_KEY is set, use Gemini API; otherwise use Vertex AI
const ai = process.env.GOOGLE_API_KEY
	? new GoogleGenAI({
			apiKey: process.env.GOOGLE_API_KEY,
		})
	: new GoogleGenAI({
			vertexai: true,
			project: process.env.GOOGLE_CLOUD_PROJECT || "enterprise-genai-project",
			location: process.env.GOOGLE_CLOUD_LOCATION || "global",
		})

const OUTPUT_DIR = path.join(__dirname, "..", "job-suitability")
const RESULTS_FILE = path.join(OUTPUT_DIR, "results.json")

// Extract job ID from filename and generate LinkedIn URL
function getLinkedInUrl(fileName: string): { jobId: string; url: string } {
	const jobId = path.basename(fileName, ".txt")
	const url = `https://www.linkedin.com/jobs/collections/recommended/?currentJobId=${jobId}`
	return { jobId, url }
}

// Load existing analysis cache
function loadAnalysisCache(): AnalysisCache {
	if (fs.existsSync(RESULTS_FILE)) {
		const content = fs.readFileSync(RESULTS_FILE, "utf-8")
		const records: AnalysisRecord[] = JSON.parse(content)
		const cache: AnalysisCache = {}
		records.forEach((record) => {
			cache[record.jobFile] = record
		})
		return cache
	}
	return {}
}

// Save analysis cache
function saveAnalysisCache(cache: AnalysisCache): void {
	const records = Object.values(cache).sort(
		(a, b) => b.result.match_score - a.result.match_score,
	)
	fs.writeFileSync(RESULTS_FILE, JSON.stringify(records, null, 2))
}

// Read resume content
function readResume(): string {
	const resumePath = path.join(__dirname, "..", "resume.md")

	if (!fs.existsSync(resumePath)) {
		console.error(`ERROR: Resume file not found at: ${resumePath}`)
		console.error("Please ensure resume.md exists in the project directory.")
		process.exit(1)
	}

	const resumeContent = fs.readFileSync(resumePath, "utf-8")

	if (!resumeContent.trim()) {
		console.error(`ERROR: Resume file is empty: ${resumePath}`)
		console.error("Please ensure resume.md contains your resume content.")
		process.exit(1)
	}

	return resumeContent
}

// Get all job posting files
function getJobPostingFiles(): string[] {
	const jobPostingsDir = process.env.JOB_POSTINGS_DIR
		? path.resolve(process.env.JOB_POSTINGS_DIR)
		: path.join(__dirname, "job-postings")
	const files = fs.readdirSync(jobPostingsDir)
	return files
		.filter((file) => file.endsWith(".txt"))
		.map((file) => path.join(jobPostingsDir, file))
}

// Read job posting content
function readJobPosting(filePath: string): string {
	return fs.readFileSync(filePath, "utf-8")
}

// Analyze job suitability with optimized prompt structure for caching
async function analyzeJobSuitability(
	jobPosting: string,
	resume: string,
): Promise<JobSuitabilityResult> {
	// Structure the prompt so the static content (instructions + resume) comes first
	// and the variable content (job posting) comes last
	// This allows Gemini to cache the static prefix automatically
	const response = await ai.models.generateContent({
		model: MODEL,
		contents: [
			{
				role: "user",
				parts: [
					{
						text: `${JOB_ANALYSIS_PROMPT}

CANDIDATE RESUME:
${resume}

---

JOB POSTING TO ANALYZE:
${jobPosting}`,
					},
				],
			},
		],
		config: {
			responseMimeType: "application/json",
			responseSchema: {
				type: "OBJECT",
				properties: {
					suitability_status: {
						type: "STRING",
						enum: ["suitable", "maybe_suitable", "not_suitable"],
						description: "Overall suitability assessment",
					},
					match_score: {
						type: "NUMBER",
						description: "Match score from 0-10",
					},
					key_gaps: {
						type: "ARRAY",
						items: { type: "STRING" },
						description: "Key gaps or missing requirements",
					},
					reasoning: {
						type: "STRING",
						description: "Brief explanation of the assessment",
					},
				},
				required: ["suitability_status", "match_score"],
			},
		},
	})

	const responseText = response.text || ""
	const result = JSON.parse(responseText)
	return result as JobSuitabilityResult
}

// Main function
async function run() {
	console.log("Starting job suitability analysis")
	console.log(
		`Using ${process.env.GOOGLE_API_KEY ? "Gemini API" : "Google Vertex AI"}`,
	)

	// Create output directory if it doesn't exist
	if (!fs.existsSync(OUTPUT_DIR)) {
		fs.mkdirSync(OUTPUT_DIR, { recursive: true })
	}

	// Load existing analysis cache
	const cache = loadAnalysisCache()
	const cachedCount = Object.keys(cache).length
	console.log(`Loaded ${cachedCount} previously analyzed jobs`)

	// Read resume
	const resume = readResume()
	console.log("Resume loaded")

	// Get all job posting files
	const jobFiles = getJobPostingFiles()
	console.log(`Found ${jobFiles.length} total job postings`)

	// Determine which jobs need analysis
	const jobsToAnalyze = jobFiles.filter((filePath) => {
		const fileName = path.basename(filePath)
		return !cache[fileName]
	})

	if (jobsToAnalyze.length === 0) {
		console.log("No new jobs to analyze. All jobs already processed.")
		console.log(`Total analyzed jobs: ${cachedCount}`)

		// Generate summary report
		const summaryPath = path.join(OUTPUT_DIR, "summary.txt")
		const summaryReport = generateSummaryReport(Object.values(cache))
		fs.writeFileSync(summaryPath, summaryReport)
		console.log(`Summary report updated: ${summaryPath}`)

		return
	}

	console.log(`${jobsToAnalyze.length} new jobs to analyze`)
	console.log("")

	// Process each new job posting
	let successCount = 0
	let errorCount = 0

	for (let i = 0; i < jobsToAnalyze.length; i++) {
		const jobFile = jobsToAnalyze[i]
		const fileName = path.basename(jobFile)

		console.log(`[${i + 1}/${jobsToAnalyze.length}] Analyzing ${fileName}...`)

		try {
			const jobPosting = readJobPosting(jobFile)
			const result = await analyzeJobSuitability(jobPosting, resume)

			// Extract LinkedIn URL
			const { jobId, url: linkedinUrl } = getLinkedInUrl(fileName)

			// Add to cache
			cache[fileName] = {
				jobFile: fileName,
				jobId,
				linkedinUrl,
				analyzedAt: new Date().toISOString(),
				result,
			}

			console.log(
				`  ✓ ${result.suitability_status.toUpperCase()} - Score: ${result.match_score}/10`,
			)
			successCount++

			// Save after each successful analysis (incremental save)
			saveAnalysisCache(cache)
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			console.log(`  ✗ Error: ${errorMsg}`)
			errorCount++
		}
	}

	// Generate summary statistics
	console.log("")
	console.log("=".repeat(80))
	console.log("Analysis Complete")
	console.log("=".repeat(80))
	console.log(`New jobs analyzed: ${successCount}`)
	console.log(`Errors: ${errorCount}`)
	console.log(`Total jobs in database: ${Object.keys(cache).length}`)

	const allResults = Object.values(cache)
	const suitable = allResults.filter(
		(r) => r.result.suitability_status === "suitable",
	)
	const maybe = allResults.filter(
		(r) => r.result.suitability_status === "maybe_suitable",
	)
	const notSuitable = allResults.filter(
		(r) => r.result.suitability_status === "not_suitable",
	)

	console.log(`Suitable: ${suitable.length}`)
	console.log(`Maybe Suitable: ${maybe.length}`)
	console.log(`Not Suitable: ${notSuitable.length}`)

	// Save final results
	saveAnalysisCache(cache)
	console.log(`Results saved to: ${RESULTS_FILE}`)

	// Generate summary report
	const summaryPath = path.join(OUTPUT_DIR, "summary.txt")
	const summaryReport = generateSummaryReport(allResults)
	fs.writeFileSync(summaryPath, summaryReport)
	console.log(`Summary report saved to: ${summaryPath}`)

	// Generate top matches file
	const topMatchesPath = path.join(OUTPUT_DIR, "top-matches.txt")
	const topMatchesReport = generateTopMatchesReport(allResults)
	fs.writeFileSync(topMatchesPath, topMatchesReport)
	console.log(`Top matches report saved to: ${topMatchesPath}`)
}

// Generate text summary report
function generateSummaryReport(results: AnalysisRecord[]): string {
	let report = "JOB SUITABILITY ANALYSIS REPORT\n"
	report += `${"=".repeat(80)}\n`
	report += `Generated: ${new Date().toISOString()}\n`
	report += `${"=".repeat(80)}\n\n`

	const suitable = results.filter(
		(r) => r.result.suitability_status === "suitable",
	)
	const maybe = results.filter(
		(r) => r.result.suitability_status === "maybe_suitable",
	)

	report += `Total Jobs Analyzed: ${results.length}\n`
	report += `Suitable: ${suitable.length} | Maybe: ${maybe.length} | Not Suitable: ${
		results.length - suitable.length - maybe.length
	}\n\n`

	report += `${"=".repeat(80)}\n`
	report += "SUITABLE JOBS (Sorted by Score)\n"
	report += `${"=".repeat(80)}\n\n`

	suitable.forEach((item, index) => {
		report += `${index + 1}. ${item.jobFile} - Score: ${item.result.match_score}/10\n`
		report += `   LinkedIn: ${item.linkedinUrl}\n`
		if (item.result.key_strengths && item.result.key_strengths.length > 0) {
			report += `   Strengths:\n`
			item.result.key_strengths.forEach((s) => {
				report += `   - ${s}\n`
			})
		}
		if (item.result.key_gaps && item.result.key_gaps.length > 0) {
			report += `   Gaps:\n`
			item.result.key_gaps.forEach((g) => {
				report += `   - ${g}\n`
			})
		}
		if (item.result.reasoning) {
			report += `   Reasoning: ${item.result.reasoning}\n`
		}
		report += `   Analyzed: ${item.analyzedAt}\n\n`
	})

	if (maybe.length > 0) {
		report += `\n${"=".repeat(80)}\n`
		report += "MAYBE SUITABLE JOBS (Worth Considering)\n"
		report += `${"=".repeat(80)}\n\n`

		maybe.slice(0, 20).forEach((item, index) => {
			report += `${index + 1}. ${item.jobFile} - Score: ${item.result.match_score}/10\n`
			report += `   LinkedIn: ${item.linkedinUrl}\n`
			if (item.result.reasoning) {
				report += `   Reasoning: ${item.result.reasoning}\n`
			}
			if (item.result.key_gaps && item.result.key_gaps.length > 0) {
				report += `   Gaps: ${item.result.key_gaps.join(", ")}\n`
			}
			report += "\n"
		})
	}

	return report
}

// Generate top matches report (quick reference)
function generateTopMatchesReport(results: AnalysisRecord[]): string {
	const sorted = [...results].sort(
		(a, b) => b.result.match_score - a.result.match_score,
	)

	let report = "TOP JOB MATCHES - QUICK REFERENCE\n"
	report += `${"=".repeat(80)}\n`
	report += `Generated: ${new Date().toISOString()}\n`
	report += `${"=".repeat(80)}\n\n`

	sorted.forEach((item, index) => {
		const statusEmoji =
			item.result.suitability_status === "suitable"
				? "✓"
				: item.result.suitability_status === "maybe_suitable"
					? "~"
					: "✗"

		report += `${index + 1}. [Score: ${item.result.match_score}/10] ${statusEmoji} ${item.jobFile}\n`
		report += `   LinkedIn: ${item.linkedinUrl}\n`
		if (item.result.reasoning) {
			report += `   ${item.result.reasoning}\n`
		}
		if (item.result.key_gaps && item.result.key_gaps.length > 0) {
			report += `   Gaps: ${item.result.key_gaps.join(", ")}\n`
		}
		report += "\n"
	})

	return report
}

// Run the analysis
run().catch((error) => {
	console.log(`Fatal error: ${error}`)
	console.error(error)
})
