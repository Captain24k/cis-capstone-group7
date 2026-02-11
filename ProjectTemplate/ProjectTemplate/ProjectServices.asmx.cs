using System;
using System.Web.Services;
using MySql.Data.MySqlClient;

namespace ProjectTemplate
{
    [WebService(Namespace = "http://tempuri.org/")]
    [WebServiceBinding(ConformsTo = WsiProfiles.BasicProfile1_1)]
    [System.ComponentModel.ToolboxItem(false)]
    [System.Web.Script.Services.ScriptService]

    public class ProjectServices : System.Web.Services.WebService
    {
        // DATABASE CREDENTIALS
        private string dbID = "cis440Spring2026team7";
        private string dbPass = "cis440Spring2026team7";
        private string dbName = "cis440Spring2026team7";

        private string getConString()
        {
            return "SERVER=107.180.1.16; PORT=3306; DATABASE=" +
                   dbName + "; UID=" + dbID + "; PASSWORD=" + dbPass;
        }

        // TEST CONNECTION
        [WebMethod(EnableSession = true)]
        public string TestConnection()
        {
            try
            {
                using (MySqlConnection con = new MySqlConnection(getConString()))
                {
                    con.Open();
                }
                return "Success!";
            }
            catch (Exception e)
            {
                return e.Message;
            }
        }

        // SAVE FEEDBACK
        [WebMethod(EnableSession = true)]
        public string SaveFeedback(string department,
                                   string category,
                                   string subject,
                                   string feedbackText)
        {
            try
            {
                using (MySqlConnection con = new MySqlConnection(getConString()))
                {
                    string sql = @"INSERT INTO feedback
                                   (department, category, subject, feedback_text)
                                   VALUES (@d, @c, @s, @f)";

                    MySqlCommand cmd = new MySqlCommand(sql, con);
                    cmd.Parameters.AddWithValue("@d", department);
                    cmd.Parameters.AddWithValue("@c", category);
                    cmd.Parameters.AddWithValue("@s", subject);
                    cmd.Parameters.AddWithValue("@f", feedbackText);

                    con.Open();
                    cmd.ExecuteNonQuery();
                }

                return "success";
            }
            catch (Exception e)
            {
                return e.Message;
            }
        }

        // GET FEEDBACK
        [WebMethod(EnableSession = true)]
        public string GetFeedback()
        {
            try
            {
                using (MySqlConnection con = new MySqlConnection(getConString()))
                {
                    string sql = @"SELECT feedback_id,
                                          created_at,
                                          department,
                                          category,
                                          subject,
                                          feedback_text
                                   FROM feedback
                                   ORDER BY feedback_id DESC";

                    MySqlCommand cmd = new MySqlCommand(sql, con);
                    con.Open();
                    MySqlDataReader reader = cmd.ExecuteReader();

                    string result = "[";

                    while (reader.Read())
                    {
                        result += "{";
                        result += "\"id\":\"" + reader["feedback_id"] + "\",";
                        result += "\"date\":\"" + reader["created_at"] + "\",";
                        result += "\"department\":\"" + reader["department"] + "\",";
                        result += "\"category\":\"" + reader["category"] + "\",";
                        result += "\"subject\":\"" + reader["subject"] + "\",";
                        result += "\"feedbackText\":\"" + reader["feedback_text"] + "\"";
                        result += "},";
                    }

                    if (result.EndsWith(","))
                        result = result.Substring(0, result.Length - 1);

                    result += "]";
                    return result;
                }
            }
            catch (Exception e)
            {
                return e.Message;
            }
        }
    }
}
