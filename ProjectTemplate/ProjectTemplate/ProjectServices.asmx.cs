<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<title>Anonymous Feedback</title>

	<!--DO NOT FORGET THIS SCRIPT TAG SO YOU CAN USE JQUERY!!!!! -->
	<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.3.1/jquery.min.js"></script>

	<script type="text/javascript">
		// Existing test method (kept)
		function TestButtonHandler() {
			var webMethod = "ProjectServices.asmx/TestConnection";
			var parameters = "{}";

			$.ajax({
				type: "POST",
				url: webMethod,
				data: parameters,
				contentType: "application/json; charset=utf-8",
				dataType: "json",
				success: function (msg) {
					var responseFromServer = msg.d;
					alert(responseFromServer);
				},
				error: function (e) {
					alert("this code will only execute if javascript is unable to access the webservice");
				}
			});
		}

		// NEW: Anonymous feedback submit
		function SubmitFeedbackHandler() {
			// Clear old messages
			$("#successBox").hide().text("");
			$("#errorBox").hide().text("");

			// Grab values
			var department = $("#ddlDepartment").val();
			var category = $("#ddlCategory").val();
			var subject = $("#txtSubject").val().trim();
			var feedback = $("#txtFeedback").val().trim();

			// Simple validation (UI-level)
			if (department === "" || category === "" || subject === "" || feedback === "") {
				$("#errorBox").text("Please complete all fields before submitting.").show();
				return;
			}

			// Web service endpoint (you'll add this method in ProjectServices.asmx later)
			var webMethod = "ProjectServices.asmx/SubmitAnonymousFeedback";

			// IMPORTANT: ASMX + jQuery expects a JSON string with matching parameter names
			var parameters = JSON.stringify({
				department: department,
				category: category,
				subject: subject,
				feedbackText: feedback
			});

			$("#btnSubmit").prop("disabled", true).text("Submitting...");

			$.ajax({
				type: "POST",
				url: webMethod,
				data: parameters,
				contentType: "application/json; charset=utf-8",
				dataType: "json",
				success: function (msg) {
					// Convention: msg.d contains the return value from ASMX
					// You can return "Success!" or a richer message from the server.
					var responseFromServer = msg.d;

					// UI confirmation (Acceptance Criteria)
					$("#successBox").text("✅ Feedback submitted successfully. Thank you.").show();

					// Optional: show server message if you want
					// $("#successBox").text(responseFromServer).show();

					// Clear form (keep dropdowns if you prefer)
					$("#txtSubject").val("");
					$("#txtFeedback").val("");
					$("#ddlDepartment").val("");
					$("#ddlCategory").val("");
				},
				error: function (e) {
					$("#errorBox").text("❌ Could not submit feedback. Please try again or test the connection.").show();
				},
				complete: function () {
					$("#btnSubmit").prop("disabled", false).text("Submit Feedback");
				}
			});
		}

		// Optional UX: character count
		$(document).ready(function () {
			$("#txtFeedback").on("input", function () {
				var len = $(this).val().length;
				$("#charCount").text(len + " / 1000");
			});
		});
	</script>

	<style>
		body {
			font-family: Arial, sans-serif;
			margin: 30px;
			background: #0f0f10;
			color: #f2f2f2;
		}

		.container {
			max-width: 720px;
			margin: 0 auto;
			background: #17181b;
			border: 1px solid #2a2c31;
			border-radius: 12px;
			padding: 22px;
		}

		h1 {
			margin: 0 0 8px 0;
			font-size: 22px;
		}

		.subtext {
			margin: 0 0 18px 0;
			color: #b7bcc6;
			line-height: 1.4;
			font-size: 14px;
		}

		.field {
			margin-bottom: 14px;
		}

		label {
			display: block;
			font-size: 13px;
			color: #cfd4df;
			margin-bottom: 6px;
		}

		select, input[type="text"], textarea {
			width: 100%;
			box-sizing: border-box;
			border: 1px solid #2a2c31;
			background: #101114;
			color: #f2f2f2;
			border-radius: 10px;
			padding: 10px 12px;
			outline: none;
		}

		textarea {
			min-height: 140px;
			resize: vertical;
		}

		.row {
			display: flex;
			gap: 12px;
		}

		.row .field {
			flex: 1;
		}

		.actions {
			display: flex;
			gap: 10px;
			align-items: center;
			margin-top: 10px;
		}

		button {
			border: 0;
			padding: 10px 14px;
			border-radius: 10px;
			cursor: pointer;
			font-weight: 600;
		}

		#btnSubmit {
			background: #3a7afe;
			color: white;
		}

		#btnTest {
			background: #2a2c31;
			color: #f2f2f2;
		}

		.note {
			color: #b7bcc6;
			font-size: 12px;
			margin-top: 10px;
		}

		.msg {
			display: none;
			margin-top: 12px;
			padding: 10px 12px;
			border-radius: 10px;
			font-size: 13px;
		}

		#successBox {
			background: rgba(46, 204, 113, 0.12);
			border: 1px solid rgba(46, 204, 113, 0.35);
			color: #bff3d0;
		}

		#errorBox {
			background: rgba(231, 76, 60, 0.12);
			border: 1px solid rgba(231, 76, 60, 0.35);
			color: #ffd1cc;
		}

		.footerRow {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-top: 6px;
			color: #b7bcc6;
			font-size: 12px;
		}
	</style>
</head>

<body>
	<div class="container">
		<h1>Anonymous Feedback</h1>
		<p class="subtext">
			Submit feedback without logging in or revealing your identity.
			Choose a department and category, then share your concern.
		</p>

		<!-- Dropdowns -->
		<div class="row">
			<div class="field">
				<label for="ddlDepartment">Department</label>
				<select id="ddlDepartment">
					<option value="">-- Select Department --</option>
					<option value="HR">HR</option>
					<option value="Finance">Finance</option>
					<option value="Operations">Operations</option>
					<option value="IT">IT</option>
					<option value="Marketing">Marketing</option>
					<option value="Sales">Sales</option>
					<option value="Other">Other</option>
				</select>
			</div>

			<div class="field">
				<label for="ddlCategory">Feedback Category</label>
				<select id="ddlCategory">
					<option value="">-- Select Category --</option>
					<option value="Workplace Safety">Workplace Safety</option>
					<option value="Harassment / Conduct">Harassment / Conduct</option>
					<option value="Management / Leadership">Management / Leadership</option>
					<option value="Process / Operations">Process / Operations</option>
					<option value="Facilities">Facilities</option>
					<option value="Pay / Benefits">Pay / Benefits</option>
					<option value="Other">Other</option>
				</select>
			</div>
		</div>

		<!-- Text box fields -->
		<div class="field">
			<label for="txtSubject">Subject</label>
			<input id="txtSubject" type="text" maxlength="120" placeholder="Short summary (e.g., 'Unsafe hallway lighting')" />
		</div>

		<div class="field">
			<label for="txtFeedback">Feedback Details</label>
			<textarea id="txtFeedback" maxlength="1000" placeholder="Write your feedback here..."></textarea>
			<div class="footerRow">
				<div class="note">No login. No name. Stored anonymously.</div>
				<div id="charCount">0 / 1000</div>
			</div>
		</div>

		<!-- Actions -->
		<div class="actions">
			<button id="btnSubmit" onclick="javascript: SubmitFeedbackHandler();">Submit Feedback</button>
			<button id="btnTest" onclick="javascript: TestButtonHandler();">Test Connection</button>
		</div>

		<!-- Confirmation / Errors -->
		<div id="successBox" class="msg"></div>
		<div id="errorBox" class="msg"></div>
	</div>
</body>
</html>