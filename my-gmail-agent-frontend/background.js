// Background script for API communication
// This script handles API calls to bypass CORS restrictions

const BASE_URL = "http://localhost:8080/api/v1/agent";

// Helper function to handle API error responses
async function handleApiError(response, customErrorMsg400 = "400 - Invalid request.") {
  const errorText = await response.text();
  const status = response.status;

  console.error("API returned error:", status, errorText);

  if (status === 429) {
    throw new Error("429 - API rate limit exceeded. Please try again later.");
  } else if (status === 503) {
    throw new Error("503 - AI service is temporarily unavailable. Please try again later.");
  } else if (status === 400) {
    throw new Error(customErrorMsg400);
  } else if (status === 500) {
    throw new Error("500 - Server error. Please try again later.");
  } else {
    throw new Error(`${status} - API error: ${errorText}`);
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background script received message:", request.action);
  
  if (request.action === "generateReply") {
    generateReply(request.emailData, request.tone)
      .then((reply) => {
        console.log("Reply generated successfully");
        sendResponse({ success: true, reply });
      })
      .catch((error) => {
        console.error("Error generating reply:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Will respond asynchronously
  }
});

// Additional handler for summarization
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle summarization
  if (request.action === "summarizeEmail") {
    summarizeEmail(request.emailContent, request.style, request.subject, request.fromAddress, request.toAddress)
      .then((summary) => {
        console.log("Summary generated successfully");
        sendResponse({ success: true, summary });
      })
      .catch((error) => {
        console.error("Error generating summary:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Will respond asynchronously
  }
});

// Handler for smart search conversion (natural language -> Gmail syntax)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "convertQuery") {
    convertQuery(request.query)
      .then((convertedText) => {
        // Backend returns plain text (standard Gmail query). Send it back to content script.
        sendResponse({ success: true, convertedQuery: convertedText || "" });
      })
      .catch((error) => {
        console.error("Error converting query:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // respond asynchronously
  }
});

// Handler for priority analysis
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzePriority") {
    analyzePriority(request.emailData)
      .then((analysis) => {
        console.log("Priority analysis generated successfully");
        sendResponse({ success: true, analysis });
      })
      .catch((error) => {
        console.error("Error generating priority analysis:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // respond asynchronously
  }
});


async function generateReply(emailData, tone) {
  try {
    console.log("Starting API call...");
    console.log("Base URL:", BASE_URL);
    console.log("Tone:", tone);
    console.log("Email subject length:", emailData.subject.length);
    console.log("Email content length:", emailData.content.length);
    
    const url = `${BASE_URL}/reply?tone=${encodeURIComponent(tone)}`;
    console.log("Full URL:", url);

    const requestBody = {
      subject: emailData.subject,
      content: emailData.content,
      fromAddress: emailData.fromAddress || "",
      toAddress: emailData.toAddress || "",
    };
    
    console.log("Request body:", JSON.stringify(requestBody).substring(0, 200) + "...");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log("API Response received");
    console.log("Response status:", response.status);
    console.log("Response status text:", response.statusText);

    if (!response.ok) {
      await handleApiError(response, "400 - Invalid email content. Please ensure the email has both subject and content.");
    }

    const reply = await response.text();
    console.log("Reply received, length:", reply.length);
    
    if (!reply) {
      throw new Error("Received empty reply from API.");
    }

    return reply;
  } catch (error) {
    console.error("Background API call error:", error.message);
    console.error("Error type:", error.constructor.name);
    console.error("Full error:", error);
    
    // Add helpful diagnostic message
    if (error.message === "Failed to fetch") {
      throw new Error(
        `Failed to connect to backend. Make sure the backend server is running on ${BASE_URL.split('/api')[0]}`
      );
    }
    
    throw error;
  }
}

// Re-enabled summarize function
async function summarizeEmail(emailContent, style, subject, fromAddress, toAddress) {
  try {
    console.log("Starting API call for summarization...");
    console.log("Base URL:", BASE_URL);
    console.log("Email content length:", emailContent.length);

    const summaryStyle = style || "Short";
    const subjectText = subject || "Thread Summary";
    const url = `${BASE_URL}/summary?style=${encodeURIComponent(summaryStyle)}`; // endpoint for summarization
    console.log("Full URL:", url);

    const requestBody = { 
      subject: subjectText,
      content: emailContent,
      fromAddress: fromAddress || "",
      toAddress: toAddress || ""
    };
    console.log(
      "Request body:",
      JSON.stringify(requestBody).substring(0, 200) + "..."
    );

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    console.log("API Response received");
    console.log("Response status:", response.status);
    console.log("Response status text:", response.statusText);

    if (!response.ok) {
      await handleApiError(response, "400 - Invalid email content. Please ensure the email body is not empty.");
    }

    const summary = await response.text();
    console.log("Summary received, length:", summary.length);

    if (!summary) {
      throw new Error("Received empty summary from API.");
    }

    return summary;
  } catch (error) {
    console.error(
      "Background API call error (summarization):",
      error.message
    );
    console.error("Error type:", error.constructor.name);
    console.error("Full error:", error);

    // Add helpful diagnostic message
    if (error.message === "Failed to fetch") {
      throw new Error(
        `Failed to connect to backend. Make sure the backend server is running on ${BASE_URL.split('/api')[0]}`
      );
    }

    throw error;
  }
}

// Priority analysis via backend
async function analyzePriority(emailData) {
  try {
    console.log("Starting API call for priority analysis...");
    console.log("Base URL:", BASE_URL);
    console.log("Email subject length:", emailData.subject.length);
    console.log("Email content length:", emailData.content.length);

    const url = `${BASE_URL}/priority`;
    const requestBody = {
      subject: emailData.subject,
      content: emailData.content,
      fromAddress: emailData.fromAddress || "",
      toAddress: emailData.toAddress || "",
    };

    console.log("Request body:", JSON.stringify(requestBody).substring(0, 200) + "...");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    console.log("API Response received");
    console.log("Response status:", response.status);
    console.log("Response status text:", response.statusText);

    if (!response.ok) {
      await handleApiError(response, "400 - Invalid email content. Please ensure the email has both subject and content.");
    }

    const analysis = await response.text();
    console.log("Priority analysis received, length:", analysis.length);

    if (!analysis) {
      throw new Error("Received empty priority analysis from API.");
    }

    return analysis;
  } catch (error) {
    console.error("Background API call error (priority analysis):", error.message);
    console.error("Error type:", error.constructor.name);
    console.error("Full error:", error);

    if (error.message === "Failed to fetch") {
      throw new Error(
        `Failed to connect to backend. Make sure the backend server is running on ${BASE_URL.split('/api')[0]}`
      );
    }

    throw error;
  }
}

// Convert natural language query via backend
async function convertQuery(naturalQuery) {
  try {
    console.log("Converting natural query via backend:", naturalQuery);
    const encoded = encodeURIComponent(naturalQuery);
    const url = `${BASE_URL}/search?userQuery=${encoded}`;

    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} - ${text}`);
    }

    const convertedText = await response.text();
    console.log("Converted query text:", convertedText);
    return convertedText;
  } catch (error) {
    console.error("convertQuery error:", error);
    if (error.message === "Failed to fetch") {
      throw new Error(
        `Failed to connect to backend. Make sure the backend server is running on ${BASE_URL.split('/api')[0]}`
      );
    }
    throw error;
  }
}