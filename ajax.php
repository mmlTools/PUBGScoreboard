<?php
namespace App\Controllers;

class ajax
{
    private
        $received = [],
        $result = [];

    public function __construct()
    {
        foreach ($_POST as $key => $val)
            $this->received[$key] = $val;

        if (!$this->validateMethod())
            exit("Invalid method: {$this->received['method']}");

        $user_function = $this->received['method'];
        unset($this->received['method']);
        $this->$user_function();

        print_r(json_encode([
            'success' => $this->result["result"],
            'body' => isset($this->result["body"]) ? $this->result["body"] : "",
            'type' => isset($this->result["type"]) ? $this->result["type"] : "",
            'recv' => isset($this->result["recv"]) ? $this->result["recv"] : []
        ]));
    }

    private function validateMethod(){
        if(!isset($this->received['method']))
            return false;

        return method_exists($this, $this->received['method']);
    }

    private function SaveTournamentData(){
        try{
            file_put_contents("tournament_data.json", json_encode($this->received["teams"]));
            $this->ParseResult(true);
        } catch (\Exception $e){
            $this->ParseResult(false);
        }
    }

    private function LoadTournamentData(){
        try{
            $content = file_get_contents("tournament_data.json");
            $this->ParseResult(true, null, null, $content);
        } catch (\Exception $e){
            $this->ParseResult(false);
        }
    }

    private function ParseResult($w = false, $x = null, $y = null, $z = null){
        $this->result["result"] = $w;
        if (!is_null($x))
            $this->result["type"] = $x;
        if (!is_null($y))
            $this->result["body"] = $y;
        if (!is_null($z))
            $this->result["recv"] = $z;
    }
}

return new ajax();