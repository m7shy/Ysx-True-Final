import os
import subprocess
import sys

def main():
    target_dir = r"D:\YT-Scraper"
    bat_path = os.path.join(target_dir, "run_midnight_sweep.bat")
    task_name = "YouTube_Scraper_Daily_Run"
    
    print("[+] Step 1: Generating the batch execution script...")
    bat_content = (
        "@echo off\n"
        f"cd /d {target_dir}\n"
        "set PYTHONIOENCODING=utf-8\n"
        "python orchestrator.py --niche \"Fitness\" --target 300\n"
        "pause\n"
    )
    
    try:
        with open(bat_path, "w", encoding="utf-8") as f:
            f.write(bat_content)
        print(f"    -> Successfully wrote: {bat_path}")
    except Exception as e:
        print(f"[-] Failed to write batch file: {e}")
        sys.exit(1)

    print("\n[+] Step 2: Registering task with Windows Task Scheduler...")
    
    # Check if task already exists and delete it to prevent duplicates
    subprocess.run(f'schtasks /delete /tn "{task_name}" /f', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Create the task via Windows CLI (Daily at 03:00 AM)
    create_cmd = (
        f'schtasks /create /tn "{task_name}" '
        f'/tr "{bat_path}" '
        f'/sc DAILY /st 03:00 /f'
    )
    
    result = subprocess.run(create_cmd, shell=True, capture_output=True, text=True)
    
    if result.returncode == 0:
        print("    -> Windows Task Scheduler successfully updated!")
        print("    -> Your engine is officially scheduled to fire every night at 3:00 AM.")
        print("\n[!] CRITICAL NOTE: Windows command-line creation restricts the 'Wake computer to run task' flag by default.")
        print("    To guarantee it wakes up your machine, open 'Task Scheduler' manually, double-click the task,")
        print("    go to the 'Conditions' tab, and check 'Wake the computer to run this task'.")
    else:
        print(f"[-] Failed to register Windows task. Error:\n{result.stderr}")

if __name__ == "__main__":
    main()