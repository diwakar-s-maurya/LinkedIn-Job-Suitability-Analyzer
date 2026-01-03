import * as fs from "node:fs"
import * as path from "node:path"
import { type Browser, chromium, type Page } from "@playwright/test"
import * as dotenv from "dotenv"

dotenv.config()

interface JobPosting {
	id: string
	title: string
	company: string
	location: string
	description: string
	url: string
	rawText: string
}

async function scrapeLinkedInJobs() {
	const targetUrl =
		process.env.LINKEDIN_JOBS_URL || "https://www.linkedin.com/jobs/search/"
	const outputDir = process.env.JOB_POSTINGS_DIR
		? path.resolve(process.env.JOB_POSTINGS_DIR)
		: path.join(__dirname, "..", "job-postings")

	// Create output directory if it doesn't exist
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true })
	}

	// Load existing job IDs from .txt files to avoid duplicates
	const existingJobIds = new Set<string>()
	const existingFiles = fs
		.readdirSync(outputDir)
		.filter((f) => f.endsWith(".txt"))
	existingFiles.forEach((file) => {
		const jobId = file.replace(".txt", "")
		existingJobIds.add(jobId)
	})

	if (existingJobIds.size > 0) {
		console.log(
			`Found ${existingJobIds.size} previously scraped jobs - these will be skipped`,
		)
	}

	console.log("Connecting to existing Chrome browser...")

	let browser: Browser
	try {
		// Connect to existing Chrome browser
		browser = await chromium.connectOverCDP("http://localhost:9222")
	} catch (_error) {
		console.error("\nFailed to connect to Chrome!")

		if (process.platform === "win32") {
			console.error("Please run: .\\start-chrome-debug.bat")
			console.error(
				'Or manually run: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222',
			)
		} else {
			console.error("Please run: ./start-chrome-debug.sh")
			console.error(
				'Or manually run: google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug-profile"',
			)
		}

		process.exit(1)
	}

	const contexts = browser.contexts()
	if (contexts.length === 0) {
		throw new Error(
			"No browser contexts found. Please make sure Chrome is running.",
		)
	}

	const context = contexts[0] // Use the default context
	const pages = context.pages()

	// Create a new page or use existing one
	let page: Page
	if (pages.length > 0) {
		// Use the first page
		page = pages[0]
		console.log("Using existing browser tab")
	} else {
		// Create new page
		page = await context.newPage()
		console.log("Created new browser tab")
	}

	try {
		console.log("Navigating to LinkedIn jobs page...")
		await page.goto(targetUrl, {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		})

		// Wait for potential redirects (e.g., to login page)
		await page.waitForTimeout(2000)

		// Check if we were redirected or blocked
		const currentUrl = page.url()
		console.log(`Current URL: ${currentUrl}`)

		// Check for LinkedIn login modal
		const loginModal = await page.$(".modal__main.w-full")
		if (loginModal) {
			console.error(
				"LinkedIn is requiring authentication. Please log in manually in the browser.",
			)
			throw new Error("Authentication required - please log in manually")
		}

		// Check URL-based redirects as fallback
		if (
			currentUrl.includes("checkpoint") ||
			currentUrl.includes("login") ||
			currentUrl.includes("authwall")
		) {
			console.error(
				"LinkedIn is requiring authentication. Please log in manually in the browser.",
			)
			throw new Error("Authentication required - please log in manually")
		}

		// Wait for page to load
		console.log("Waiting for job listings to load...")
		await page.waitForLoadState("domcontentloaded")
		await page.waitForTimeout(3000) // Give page time to render

		// Wait for the specific job list element using XPath
		console.log("Waiting for job list element...")
		await page.waitForSelector(
			'xpath=//*[@id="main"]/div/div[2]/div[1]/div/ul',
			{ timeout: 30000 },
		)
		console.log("Job list found!")

		const jobs: JobPosting[] = []
		let pageNumber = 1
		let hasMorePages = true
		let skippedCount = 0

		while (hasMorePages) {
			console.log(`\n=== Processing Page ${pageNumber} ===`)

			// Scroll to load more jobs on current page
			console.log("Scrolling to load more jobs...")
			await autoScroll(page)
			await page.waitForTimeout(2000)

			// Get all job card elements using XPath
			const jobCards = await page.$$(
				'xpath=//*[@id="main"]/div/div[2]/div[1]/div/ul/li',
			)
			console.log(`Found ${jobCards.length} job listings on page ${pageNumber}`)

			for (let i = 0; i < jobCards.length; i++) {
				try {
					console.log(
						`Processing job ${i + 1}/${jobCards.length} of page ${pageNumber}...`,
					)

					// Click on the job card to load details with human-like delay
					await jobCards[i].click()
					await page.waitForTimeout(1500 + Math.random() * 1000) // Random delay 1.5-2.5s

					// Wait for job details to load
					await page
						.waitForSelector('xpath=//*[@id="job-details"]', { timeout: 10000 })
						.catch(() => {
							console.log(
								`Job ${i + 1}: Job details panel not found, skipping...`,
							)
							return null
						})

					// Extract job ID from the URL or data attribute
					const jobId = await jobCards[i].evaluate((el) => {
						const link = el.querySelector("a")
						if (link) {
							const href = link.getAttribute("href") || ""
							const match = href.match(/\/jobs\/view\/(\d+)/)
							return match
								? match[1]
								: `job-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
						}
						return `job-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
					})

					// Skip if already scraped
					if (existingJobIds.has(jobId)) {
						console.log(
							`Job ${i + 1}: Already scraped (ID: ${jobId}), skipping...`,
						)
						skippedCount++
						continue
					}

					// Extract all content from the job-details panel
					const jobDetailsElement = await page.$('xpath=//*[@id="job-details"]')

					if (!jobDetailsElement) {
						console.log(`Job ${i + 1}: Could not find job details, skipping...`)
						continue
					}

					// Get the HTML content from job-details and convert to formatted text
					const jobDetailsText = await jobDetailsElement.evaluate((el) => {
						// Helper function to convert HTML to formatted text
						function htmlToFormattedText(element: Element): string {
							let text = ""

							for (const node of Array.from(element.childNodes)) {
								if (node.nodeType === Node.TEXT_NODE) {
									const content = node.textContent?.trim()
									if (content) {
										text += `${content} `
									}
								} else if (node.nodeType === Node.ELEMENT_NODE) {
									const elem = node as HTMLElement
									const tagName = elem.tagName.toLowerCase()

									// Handle different HTML elements
									if (tagName === "br") {
										text += "\n"
									} else if (tagName === "p") {
										text += `\n${htmlToFormattedText(elem).trim()}\n`
									} else if (tagName === "div") {
										const inner = htmlToFormattedText(elem).trim()
										if (inner) text += `\n${inner}`
									} else if (
										tagName === "h1" ||
										tagName === "h2" ||
										tagName === "h3" ||
										tagName === "h4" ||
										tagName === "h5" ||
										tagName === "h6"
									) {
										text +=
											"\n\n" +
											htmlToFormattedText(elem).trim().toUpperCase() +
											"\n"
									} else if (tagName === "li") {
										text += `\n• ${htmlToFormattedText(elem).trim()}`
									} else if (tagName === "ul" || tagName === "ol") {
										text += `\n${htmlToFormattedText(elem)}`
									} else if (tagName === "strong" || tagName === "b") {
										text += `${htmlToFormattedText(elem).trim()} `
									} else if (tagName === "em" || tagName === "i") {
										text += `${htmlToFormattedText(elem).trim()} `
									} else if (tagName === "span") {
										text += htmlToFormattedText(elem)
									} else if (tagName === "a") {
										text += htmlToFormattedText(elem)
									} else {
										text += htmlToFormattedText(elem)
									}
								}
							}

							return text
						}

						const formatted = htmlToFormattedText(el)
						// Clean up extra whitespace while preserving intentional line breaks
						return formatted
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0)
							.join("\n")
					})

					// Extract company name from the specific XPath
					let company = "N/A"
					const companyElement = await page.$(
						'xpath=//*[@id="main"]/div/div[2]/div[2]/div/div[2]/div/div[2]/div[1]/div/div[1]/div/div[1]/div/div[2]',
					)
					if (companyElement) {
						const text = await companyElement.textContent()
						if (text) company = text.trim()
					}

					// Extract location from the specific XPath
					let location = "N/A"
					const locationElement = await page.$(
						'xpath=//*[@id="main"]/div/div[2]/div[2]/div/div[2]/div/div[2]/div[1]/div/div[1]/div/div[1]/div/div[3]',
					)
					if (locationElement) {
						const text = await locationElement.textContent()
						if (text) location = text.trim()
					}

					// Extract title
					let title = "N/A"
					const titleElement = await jobDetailsElement.$(
						'h1, h2, [class*="job-title"]',
					)
					if (titleElement) {
						const text = await titleElement.textContent()
						if (text) title = text.trim()
					}

					const job: JobPosting = {
						id: jobId,
						title: title?.trim() || "N/A",
						company: company?.trim() || "N/A",
						location: location?.trim() || "N/A",
						description: jobDetailsText.trim(),
						url: `https://www.linkedin.com/jobs/view/${jobId}`,
						rawText: jobDetailsText.trim(),
					}

					jobs.push(job)

					// Save individual job to text file with company, location, and raw text
					const filename = `${jobId}.txt`
					const filepath = path.join(outputDir, filename)

					const fileContent = `Company: ${company}\nLocation: ${location}\n\n${jobDetailsText.trim()}`
					fs.writeFileSync(filepath, fileContent)
					console.log(`Saved: ${filename}`)
				} catch (error) {
					console.error(`Error processing job ${i + 1}:`, error)
				}
			}

			// Try to find and click the next button
			console.log("\nLooking for next page button...")

			// Scroll to the bottom to make sure pagination is visible
			await page.evaluate(() => {
				window.scrollTo(0, document.body.scrollHeight)
			})
			await page.waitForTimeout(1000)

			// Find the next button
			const nextButton = await page.$('button[aria-label="View next page"]')

			if (nextButton) {
				// Check if the button is enabled/clickable
				const isDisabled = await nextButton.evaluate(
					(btn) =>
						btn.hasAttribute("disabled") ||
						btn.classList.contains("artdeco-button--disabled"),
				)

				if (!isDisabled) {
					console.log("Clicking next button...")

					// Scroll the button into view and click
					await nextButton.scrollIntoViewIfNeeded()
					await page.waitForTimeout(500)
					await nextButton.click()

					console.log("Waiting for next page to load...")
					await page.waitForTimeout(3000 + Math.random() * 2000) // Wait 3-5 seconds

					// Wait for the job list to reload
					await page.waitForSelector(
						'xpath=//*[@id="main"]/div/div[2]/div[1]/div/ul',
						{
							timeout: 15000,
						},
					)
					pageNumber++
					console.log(`Successfully loaded page ${pageNumber}`)
				} else {
					console.log("Next button is disabled - reached last page")
					hasMorePages = false
				}
			} else {
				console.log("No next button found - reached last page")
				hasMorePages = false
			}
		}

		console.log(`\n=== Scraping Complete ===`)
		console.log(
			`Successfully scraped ${jobs.length} NEW job postings across ${pageNumber} pages`,
		)
		console.log(`Skipped ${skippedCount} previously scraped jobs`)
		console.log(`Total unique jobs now: ${existingJobIds.size + jobs.length}`)
		console.log(`Files saved to: ${outputDir}`)

		// Also save a summary file with all jobs
		const summaryPath = path.join(outputDir, "_summary.json")
		fs.writeFileSync(summaryPath, JSON.stringify(jobs, null, 2))
		console.log(`Summary saved to: _summary.json`)
	} catch (error) {
		console.error("Error during scraping:", error)
	} finally {
		// Don't close the browser since we're using an existing one
		// Just let it disconnect naturally
		console.log("Scraping completed. Browser remains open.")
		process.exit(0)
	}
}

async function autoScroll(page: Page) {
	await page.evaluate(async () => {
		// Use the specific XPath to find the job list container
		const resultsContainer = document.evaluate(
			'//*[@id="main"]/div/div[2]/div[1]/div/ul',
			document,
			null,
			XPathResult.FIRST_ORDERED_NODE_TYPE,
			null,
		).singleNodeValue as HTMLElement

		if (resultsContainer) {
			await new Promise<void>((resolve) => {
				let totalHeight = 0
				const distance = 100
				const timer = setInterval(() => {
					const scrollHeight = resultsContainer.scrollHeight
					resultsContainer.scrollBy(0, distance)
					totalHeight += distance

					if (totalHeight >= scrollHeight) {
						clearInterval(timer)
						resolve()
					}
				}, 100)
			})
		}
	})
	await page.waitForTimeout(1000)
}

// Run the scraper
scrapeLinkedInJobs().catch(console.error)
