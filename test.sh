#!/bin/bash
# Simple API test script - run with: bash test.sh

BASE="http://localhost:3000"
PASS=0
FAIL=0

check() {
  if echo "$2" | grep -q "$3"; then
    echo "✅ $1"
    ((PASS++))
  else
    echo "❌ $1 - Expected '$3' in response"
    ((FAIL++))
  fi
}

echo "=== Testing API ==="

# Health check
R=$(curl -sS $BASE/api/health)
check "Health endpoint" "$R" '"ok":true'

# Login employee
R=$(curl -sS -X POST $BASE/api/login -H "Content-Type: application/json" -d '{"user":"emp1","password":"pass1"}')
check "Employee login" "$R" '"ok":true'
EMP_TOKEN=$(echo $R | sed 's/.*"token":"\([^"]*\)".*/\1/')

# Login manager
R=$(curl -sS -X POST $BASE/api/login -H "Content-Type: application/json" -d '{"user":"manager1","password":"admin1"}')
check "Manager login" "$R" '"ok":true'
MGR_TOKEN=$(echo $R | sed 's/.*"token":"\([^"]*\)".*/\1/')

# Submit feedback (employee)
R=$(curl -sS -X POST $BASE/api/feedback -H "Authorization: Bearer $EMP_TOKEN" -H "Content-Type: application/json" -d '{"department":"IT","category":"Safety","subject":"Test","feedback_text":"Test"}')
check "Submit feedback" "$R" '"ok":true'

# Get feedback (employee)
R=$(curl -sS $BASE/api/feedback/employee -H "Authorization: Bearer $EMP_TOKEN")
check "Employee browse feedback" "$R" '"ok":true'

# Get feedback (manager)
R=$(curl -sS $BASE/api/feedback -H "Authorization: Bearer $MGR_TOKEN")
check "Manager get feedback" "$R" '"ok":true'

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
